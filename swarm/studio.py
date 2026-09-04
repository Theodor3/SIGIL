"""Read a pinned, sanitized Git snapshot and stage changes without host execution."""

import ast
import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path, PurePosixPath

from .store import now, uid

MAX_FILE_BYTES = 120_000
MAX_SNAPSHOT_BYTES = 3_000_000
MAX_DRAFTS = 24
MAX_DIFF_BYTES = 24_000
MAX_OUTPUT_BYTES = 32_000
TEST_IMAGE = "sigil-swarm-tests:pilot"
DOCKER_ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine" if os.name == "nt" else "unix:///var/run/docker.sock"
ROOT_FILES = {
    "AGENTS.md", "README.md", "README.txt", "Dockerfile", "Dockerfile.api",
    "docker-compose.yml", "pyproject.toml", "pytest.ini", "setup.cfg",
    "requirements.txt", "requirements-dev.txt", "package.json", "tsconfig.json",
    "alembic.ini", "railway.json", "start.sh",
}
ROOTS = {"api", "web", "tests", "docs", "swarm"}
SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".html",
            ".json", ".md", ".txt", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".sh"}
EXCLUDED_PARTS = {"node_modules", "__pycache__", "venv", "env", "runtime", "logs",
                  "backups", "datasets", "outputs", "credentials", "secrets"}
SECRET_NAME = re.compile(r"(?:^|[_.-])(?:credentials?|secrets?|passwords?|tokens?|private[-_]?key|positions|accounts?|trades)(?:[_.-]|$)", re.I)
SECRET_LITERAL = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|"
    r"(?i:(?:https?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?)://)[^/\s:@]+:[^/\s@]+@|"
    r"\bAIza[0-9A-Za-z_-]{30,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|"
    r"\b(?:sk-(?:proj-|ant-)?|gh[pousr]_)[0-9A-Za-z_-]{20,}|"
    r"(?i:Bearer) [0-9A-Za-z._-]{20,}|"
    r"(?i:(?:api[_-]?key|access[_-]?(?:token|key)|auth[_-]?token|token|password|(?:client[_-]?)?secret(?:[_-]?(?:key|access[_-]?key))?))"
    r"[\"']?\s*[:=]\s*[\"']([^\"'\r\n]{8,})[\"']"
)


def _path(value):
    if not isinstance(value, str) or not value or len(value) > 240:
        raise ValueError("Choose a relative source path from the studio.")
    if "\\" in value or ":" in value or any(ord(c) < 32 for c in value):
        raise ValueError("The source path is not allowed.")
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or any(p in (".", "..") for p in parsed.parts) or str(parsed) != value:
        raise ValueError("The source path is not allowed.")
    return parsed


def _allowed(value):
    try:
        path = _path(value)
    except ValueError:
        return False
    if any(p.startswith(".") or p.lower() in EXCLUDED_PARTS for p in path.parts):
        return False
    if SECRET_NAME.search(path.name):
        return False
    if len(path.parts) == 1:
        return value in ROOT_FILES
    if path.parts[0] not in ROOTS or path.suffix.lower() not in SUFFIXES:
        return False
    # Source modules under api/data and api/db are useful; their stored data is not.
    if any(p.lower() in {"data", "db"} for p in path.parts[:-1]) and path.suffix.lower() not in {".py", ".md"}:
        return False
    return True


def _safe_text(raw):
    if len(raw) > MAX_FILE_BYTES or b"\x00" in raw:
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if any(ord(c) < 32 and c not in "\t\r\n" for c in text):
        return None
    # Withhold entire files rather than presenting a redacted version as real code.
    if SECRET_LITERAL.search(text):
        return None
    return text


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# This bootstrap is trusted controller code. Only this program materializes files;
# pytest and candidate code execute exclusively inside the restricted container.
CONTAINER_SCRIPT = r'''
import json, os, pathlib, subprocess, sys
payload = json.load(sys.stdin)
root = pathlib.Path('/workspace/project')
root.mkdir()
for name, content in payload['files'].items():
    path = root.joinpath(*name.split('/'))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
env = {'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'),
       'HOME': '/tmp', 'TMPDIR': '/tmp', 'PYTHONDONTWRITEBYTECODE': '1',
       'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1', 'PYTHONPATH': str(root)}
result = subprocess.run([sys.executable, '-m', 'pytest', payload['target'],
                         '-q', '--tb=short', '-p', 'no:cacheprovider'],
                        cwd=root, env=env)
sys.exit(result.returncode)
'''


class GitStudio:
    def __init__(self, root=None, commit=None):
        self.root = Path(root or Path(__file__).resolve().parent.parent).resolve()
        if commit is not None and (not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40,64}", commit)):
            raise ValueError("Choose a full recorded Git commit for this snapshot.")
        self.commit = self._git("rev-parse", "--verify", (commit or "HEAD") + "^{commit}").decode().strip()
        if not re.fullmatch(r"[0-9a-f]{40,64}", self.commit):
            raise ValueError("The studio could not pin a Git revision.")
        self.branch = self._git("branch", "--show-current").decode().strip() or "detached"
        self.files = {}
        self._tracked_paths = set()
        self._withheld = 0
        total = 0
        candidates = []
        listing = self._git("ls-tree", "-r", "-z", "--long", self.commit)
        for entry in listing.split(b"\x00"):
            if not entry:
                continue
            metadata, encoded_path = entry.split(b"\t", 1)
            mode, kind, blob, size = metadata.split()
            try:
                path = encoded_path.decode("utf-8")
            except UnicodeDecodeError:
                continue
            self._tracked_paths.add(path)
            if mode not in (b"100644", b"100755") or kind != b"blob" or not _allowed(path):
                continue
            if int(size) > MAX_FILE_BYTES or total + int(size) > MAX_SNAPSHOT_BYTES:
                self._withheld += 1
                continue
            candidates.append((path, blob, int(size)))
            total += int(size)
        # One bounded Git subprocess supplies all selected blobs. No worktree
        # files or Git content filters are consulted by cat-file.
        packed = self._git("cat-file", "--batch", input=b"\n".join(c[1] for c in candidates) + b"\n") if candidates else b""
        offset = 0
        for path, blob, size in candidates:
            end_header = packed.find(b"\n", offset)
            if end_header < 0 or packed[offset:end_header].split() != [blob, b"blob", str(size).encode()]:
                raise ValueError("The Git snapshot could not be read consistently.")
            offset = end_header + 1
            raw = packed[offset:offset + size]
            if len(raw) != size or packed[offset + size:offset + size + 1] != b"\n":
                raise ValueError("The Git snapshot was incomplete.")
            offset += size + 1
            text = _safe_text(raw)
            if text is None:
                self._withheld += 1
                continue
            self.files[path] = text
        self._sandbox_cache = None
        self._sandbox_at = 0
        self._sandbox_lock = threading.Lock()

    def _git(self, *args, input=None):
        try:
            result = subprocess.run(["git", "--no-pager", "-C", str(self.root), *args],
                                    capture_output=True, check=True, timeout=10, input=input)
        except (OSError, subprocess.SubprocessError):
            raise ValueError("The studio cannot read this checkout's Git snapshot.") from None
        return result.stdout

    def _sandbox(self, refresh=False):
        with self._sandbox_lock:
            if self._sandbox_cache is not None and not refresh and time.monotonic() - self._sandbox_at < 10:
                return dict(self._sandbox_cache)
            result = {"available": False, "image": None,
                      "note": "Python execution is blocked until the local isolated test image is ready."}
            docker = shutil.which("docker")
            if docker:
                try:
                    check = subprocess.run([docker, "--host", DOCKER_ENDPOINT, "image", "inspect", TEST_IMAGE, "--format", "{{.Id}}"],
                                           capture_output=True, timeout=6, check=False)
                    image_id = check.stdout.decode("utf-8", errors="replace").strip()
                    if check.returncode == 0 and re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
                        result = {"available": True, "image": image_id, "docker": docker,
                                  "note": "Pytest runs only in an isolated local container using the pinned test image. No project services or network access are available."}
                except (OSError, subprocess.SubprocessError):
                    pass
            self._sandbox_cache, self._sandbox_at = result, time.monotonic()
            return dict(result)

    def manifest(self):
        sandbox = self._sandbox()
        return {"commit": self.commit, "branch": self.branch, "file_count": len(self.files),
                "files": [{"path": p, "size": len(t.encode("utf-8"))} for p, t in sorted(self.files.items())],
                "capabilities": {"read": True, "search": True, "draft": True, "syntax": True,
                                 "execution": sandbox["available"], "run_pytest": sandbox["available"]},
                "execution_note": sandbox["note"], "snapshot_note": "Tracked text at the pinned commit only. Hidden, sensitive, binary and oversized files are withheld; working-copy changes are excluded."}

    def read(self, path, start=1):
        _path(path)
        if path not in self.files:
            raise ValueError("This file is not in the sanitized snapshot.")
        if not isinstance(start, int) or isinstance(start, bool) or start < 1:
            raise ValueError("The first line must be a positive number.")
        text = self.files[path]
        lines = text.splitlines(keepends=True)
        if start > max(1, len(lines)):
            raise ValueError("The first line is beyond this file.")
        selected = "".join(lines[start - 1:start + 119])[:8000]
        count = len(selected.splitlines())
        return {"path": path, "start": start, "end": start + count - 1,
                "total_lines": len(lines), "text": selected, "sha256": _sha(text), "commit": self.commit}

    def search(self, query):
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ValueError("Search for 1 to 200 characters of source text.")
        needle = query.casefold()
        matches = []
        for path, text in sorted(self.files.items()):
            for number, line in enumerate(text.splitlines(), 1):
                if needle in line.casefold():
                    if len(matches) == 80:
                        return {"matches": matches, "truncated": True}
                    matches.append({"path": path, "line": number, "text": line[:400]})
        return {"matches": matches, "truncated": False}

    def draft(self, path, content, author):
        _path(path)
        if not _allowed(path):
            raise ValueError("Drafts must use an allowed source path.")
        if not isinstance(content, str) or _safe_text(content.encode("utf-8")) is None:
            raise ValueError("The draft must be small text without credential literals.")
        if not isinstance(author, str) or not author or len(author) > 80:
            raise ValueError("The draft needs a recorded author.")
        # A withheld tracked path must never be silently treated as a new file.
        if path not in self.files:
            parts = PurePosixPath(path).parts
            if path in self._tracked_paths or any("/".join(parts[:i]) in self._tracked_paths for i in range(1, len(parts))):
                raise ValueError("This tracked path is excluded from the sanitized snapshot.")
        before = self.files.get(path)
        diff = "".join(difflib.unified_diff((before or "").splitlines(keepends=True),
                                          content.splitlines(keepends=True),
                                          fromfile="a/" + path if before is not None else "/dev/null",
                                          tofile="b/" + path))
        if len(diff.encode("utf-8")) > MAX_DIFF_BYTES:
            raise ValueError("This draft changes too much text. Propose a narrower change with a diff below 24 KB.")
        return {"id": uid("draft"), "path": path, "author": author,
                "before_sha256": _sha(before) if before is not None else None,
                "content": content, "diff": diff, "status": "draft", "created_at": now(),
                "commit": self.commit}

    def _draft_files(self, drafts):
        if not isinstance(drafts, list) or len(drafts) > MAX_DRAFTS:
            raise ValueError("A studio check accepts at most 24 draft files.")
        files = {}
        for item in drafts:
            if not isinstance(item, dict):
                raise ValueError("A draft is invalid.")
            path, content = item.get("path"), item.get("content")
            checked = self.draft(path, content, item.get("author", "studio"))
            if item.get("commit", self.commit) != self.commit or item.get("before_sha256") != checked["before_sha256"]:
                raise ValueError("This draft belongs to a different source snapshot.")
            files[path] = content
        if sum(len(t.encode("utf-8")) for t in files.values()) > 600_000:
            raise ValueError("The draft set exceeds the studio's size limit.")
        return files

    def syntax(self, drafts):
        files = self._draft_files(drafts)
        checks = []
        for path, content in files.items():
            language = PurePosixPath(path).suffix.lower()
            check = {"path": path, "status": "not_checked", "message": "No syntax parser is enabled for this file type."}
            try:
                if language == ".py":
                    ast.parse(content, filename=path)
                elif language == ".json":
                    json.loads(content)
                else:
                    checks.append(check)
                    continue
                check.update(status="passed", message="Syntax parsed only; no code was imported or executed.")
            except (SyntaxError, ValueError, RecursionError) as exc:
                check.update(status="failed", message="Invalid syntax.", line=getattr(exc, "lineno", None))
            checks.append(check)
        return {"status": "failed" if any(c["status"] == "failed" for c in checks) else "passed" if checks and all(c["status"] == "passed" for c in checks) else "not_checked",
                "checks": checks, "executed": False, "commit": self.commit}

    def run_tests(self, drafts, target):
        parsed = _path(target)
        if not any(target == p or target.startswith(p + "/") for p in ("tests", "api/tests", "swarm/tests", "web/tests")):
            raise ValueError("Select a test path inside the snapshot's tests folders.")
        if parsed.suffix and parsed.suffix != ".py":
            raise ValueError("Only Python tests can run in this studio.")
        files = dict(self.files)
        files.update(self._draft_files(drafts))
        if target not in files and not any(p.startswith(target + "/") and p.endswith(".py") for p in files):
            raise ValueError("This test target is not in the snapshot or drafts.")
        sandbox = self._sandbox(refresh=True)
        if not sandbox["available"]:
            return {"status": "blocked", "executed": False, "target": target, "output": sandbox["note"], "commit": self.commit}
        name = "sigil-studio-" + uid("run").removeprefix("run_")
        command = [sandbox["docker"], "--host", DOCKER_ENDPOINT, "run", "--rm", "--pull=never", "--name", name,
                   "--network=none", "--read-only", "--user", "65534:65534",
                   "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64",
                   "--memory=256m", "--memory-swap=256m", "--cpus=1",
                   "--tmpfs", "/workspace:rw,nosuid,nodev,noexec,size=64m,mode=1777",
                   "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777",
                   "--workdir", "/workspace", "--entrypoint", "python", "-i", sandbox["image"],
                   "-I", "-c", CONTAINER_SCRIPT]
        payload = json.dumps({"files": files, "target": target}).encode("utf-8")
        output, timed_out, exit_code, truncated = bytearray(), False, None, False
        process = None
        threads = []
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT)

            def read_output():
                nonlocal truncated
                while True:
                    chunk = process.stdout.read(8192)
                    if not chunk:
                        break
                    available = MAX_OUTPUT_BYTES - len(output)
                    output.extend(chunk[:available])
                    if len(chunk) > available:
                        truncated = True

            def send_input():
                try:
                    process.stdin.write(payload)
                    process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass

            threads = [threading.Thread(target=read_output, daemon=True), threading.Thread(target=send_input, daemon=True)]
            for thread in threads:
                thread.start()
            try:
                exit_code = process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                timed_out = True
                process.kill()
                process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            return {"status": "blocked", "executed": False, "target": target,
                    "output": "The isolated test container could not start or finish reliably.", "commit": self.commit}
        finally:
            try:
                subprocess.run([sandbox["docker"], "--host", DOCKER_ENDPOINT, "rm", "-f", name], capture_output=True, timeout=6, check=False)
            except (OSError, subprocess.SubprocessError):
                pass
            for thread in threads:
                thread.join(timeout=2)
        launch_failed = not timed_out and exit_code in (125, 126, 127)
        return {"status": "timed_out" if timed_out else "blocked" if launch_failed else "passed" if exit_code == 0 else "failed",
                "executed": not launch_failed, "target": target, "exit_code": exit_code,
                "output": output.decode("utf-8", errors="replace"), "truncated": truncated,
                "commit": self.commit, "image": sandbox["image"],
                "note": "Isolated pytest run only. This does not validate live services, market performance or a production deployment."}

    def check(self, drafts, target):
        return self.run_tests(drafts, target)
