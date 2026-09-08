import io
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from swarm.studio import DOCKER_ENDPOINT, GitStudio, MAX_OUTPUT_BYTES


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True).stdout


@pytest.fixture
def repository(tmp_path):
    root = tmp_path / "repository"
    root.mkdir()
    git(root, "init")
    git(root, "config", "user.email", "fixture@example.invalid")
    git(root, "config", "user.name", "Studio fixture")
    for name, content in {
        "api/example.py": "value = 1\n",
        "tests/test_example.py": "def test_example():\n    assert 1 == 1\n",
        "docs/readme.md": "A fixture document\n",
        "api/hidden_literal.py": 'api_key = "synthetic-credential-fixture"\n',
        "api/db/snapshot.json": '{"positions": [1]}',
        "api/blob.py": "before\x00after",
        ".env": "TOKEN=private-fixture\n",
        ".hidden/test.py": "value = 2\n",
    }.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    git(root, "add", ".")
    git(root, "commit", "-m", "Snapshot fixture")
    return root


def test_snapshot_is_pinned_and_ignores_untracked_and_sensitive_files(repository):
    studio = GitStudio(repository)
    pinned = studio.commit
    (repository / "api/example.py").write_text("value = 2\n")
    (repository / "api/untracked.py").write_text('secret = "untracked-fixture"')
    git(repository, "add", "api/example.py")
    git(repository, "commit", "-m", "Later revision")
    complete = studio.read("api/example.py")
    assert complete["text"] == "value = 1\n"
    assert complete["complete_file"] is True
    assert complete["line_truncated"] is False
    assert complete["text_truncated"] is False
    assert studio.read("api/example.py")["commit"] == pinned
    restarted = GitStudio(repository, commit=pinned)
    assert restarted.read("api/example.py")["text"] == "value = 1\n"
    assert set(studio.files) == {"api/example.py", "tests/test_example.py", "docs/readme.md"}
    assert studio.search("value")["matches"][0]["text"] == "value = 1"


@pytest.mark.parametrize("path", ["../escape.py", "/tmp/escape.py", "C:/escape.py", "api/../escape.py", "api\\escape.py", "api//escape.py", "api/.private.py", ".env", "api/secrets.py"])
def test_paths_cannot_escape_or_access_private_files(repository, path):
    studio = GitStudio(repository)
    with pytest.raises(ValueError):
        studio.read(path)
    with pytest.raises(ValueError):
        studio.draft(path, "x = 1\n", "engineering")


def test_drafts_never_change_checkout_and_parse_does_not_execute(repository, tmp_path):
    studio = GitStudio(repository)
    marker = tmp_path / "must-not-exist"
    content = "from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('executed')\n"
    draft = studio.draft("api/example.py", content, "engineering")
    result = studio.syntax([draft])
    assert result["status"] == "passed" and result["executed"] is False
    assert not marker.exists()
    assert (repository / "api/example.py").read_text() == "value = 1\n"
    assert draft["before_sha256"] == studio.read("api/example.py")["sha256"]
    assert "write_text" in draft["diff"]
    with pytest.raises(ValueError):
        studio.draft("api/hidden_literal.py", "value = 1\n", "engineering")


def test_syntax_errors_and_snapshot_mismatch_are_reported(repository):
    studio = GitStudio(repository)
    invalid = studio.draft("tests/test_new.py", "def broken(:\n", "engineering")
    assert studio.syntax([invalid])["status"] == "failed"
    invalid["commit"] = "0" * 40
    with pytest.raises(ValueError, match="different source snapshot"):
        studio.syntax([invalid])
    with pytest.raises(ValueError, match="narrower change"):
        studio.draft("docs/too_large.md", "x" * 25_000, "engineering")


def test_git_symlinks_and_submodules_are_not_shared_or_draft_parents(repository):
    blob = subprocess.run(["git", "-C", str(repository), "hash-object", "-w", "--stdin"],
                          input=b"/outside/secret", capture_output=True, check=True).stdout.decode().strip()
    git(repository, "update-index", "--add", "--cacheinfo", "120000," + blob + ",api/link.py")
    commit = git(repository, "rev-parse", "HEAD").decode().strip()
    git(repository, "update-index", "--add", "--cacheinfo", "160000," + commit + ",api/external")
    git(repository, "commit", "-m", "Nonregular fixture entries")
    studio = GitStudio(repository)
    assert "api/link.py" not in studio.files and "api/external" not in studio.files
    for path in ("api/link.py", "api/external/escape.py"):
        with pytest.raises(ValueError):
            studio.draft(path, "pass\n", "engineering")


def test_read_and_search_are_bounded(repository):
    long_content = "match " + "x" * 9000 + "\n" + "match\n" * 200
    (repository / "docs/long.md").write_text(long_content)
    git(repository, "add", "docs/long.md")
    git(repository, "commit", "-m", "Long fixture")
    studio = GitStudio(repository)
    assert len(studio.read("docs/long.md")["text"]) <= 8000
    assert studio.read("docs/long.md", 2)["end"] <= 121
    matches = studio.search("match")
    assert len(matches["matches"]) == 80 and matches["truncated"]
    assert all(len(m["text"]) <= 400 for m in matches["matches"])


def test_read_marks_started_and_line_limited_chunks_incomplete(repository):
    started = GitStudio(repository).read("tests/test_example.py", start=2)
    assert started["text"] == "    assert 1 == 1\n"
    assert started["complete_file"] is False
    assert started["line_truncated"] is False
    assert started["text_truncated"] is False

    content = "".join(f"line {number}\n" for number in range(1, 122))
    (repository / "docs/many-lines.md").write_text(content, encoding="utf-8")
    git(repository, "add", "docs/many-lines.md")
    git(repository, "commit", "-m", "Many-line fixture")
    limited = GitStudio(repository).read("docs/many-lines.md")
    assert limited["end"] == 120
    assert limited["total_lines"] == 121
    assert limited["complete_file"] is False
    assert limited["line_truncated"] is True
    assert limited["text_truncated"] is False


def test_read_marks_single_huge_final_line_incomplete(repository):
    content = "x" * 8_001
    (repository / "docs/huge-line.md").write_text(content, encoding="utf-8")
    git(repository, "add", "docs/huge-line.md")
    git(repository, "commit", "-m", "Huge-line fixture")
    result = GitStudio(repository).read("docs/huge-line.md")
    assert result["text"] == "x" * 8_000
    assert result["start"] == result["end"] == result["total_lines"] == 1
    assert result["complete_file"] is False
    assert result["line_truncated"] is False
    assert result["text_truncated"] is True


def test_execution_is_blocked_without_local_image(repository, monkeypatch):
    studio = GitStudio(repository)
    monkeypatch.setattr("swarm.studio.shutil.which", lambda _: None)
    assert studio.manifest()["capabilities"]["execution"] is False
    result = studio.run_tests([], "tests/test_example.py")
    assert result["status"] == "blocked" and result["executed"] is False
    with pytest.raises(ValueError):
        studio.run_tests([], "api/example.py")


@pytest.mark.parametrize("docker_exit", [0, 125, 126, 127, "timeout"])
def test_docker_uses_isolation_pinned_image_stdin_and_bounded_output(repository, monkeypatch, docker_exit):
    studio = GitStudio(repository)
    commands, input_bytes = [], []
    image_id = "sha256:" + "a" * 64
    monkeypatch.setattr("swarm.studio.shutil.which", lambda _: "docker")

    def fake_run(command, **kwargs):
        commands.append(command)
        return SimpleNamespace(returncode=0, stdout=(image_id + "\n").encode())

    class Input(io.BytesIO):
        def close(self):
            input_bytes.append(self.getvalue())
            super().close()

    class Process:
        def __init__(self, command, **kwargs):
            commands.append(command)
            assert "shell" not in kwargs
            self.stdin = Input()
            self.stdout = io.BytesIO(b"x" * (MAX_OUTPUT_BYTES + 100))
            self.killed = False

        def wait(self, timeout):
            assert timeout <= 45
            if docker_exit == "timeout":
                if not self.killed:
                    raise subprocess.TimeoutExpired("docker", timeout)
                return 137
            return docker_exit

        def kill(self):
            self.killed = True

    monkeypatch.setattr("swarm.studio.subprocess.run", fake_run)
    monkeypatch.setattr("swarm.studio.subprocess.Popen", Process)
    result = studio.run_tests([], "tests/test_example.py")
    command = next(c for c in commands if "run" in c)
    assert command[command.index("--host") + 1] == DOCKER_ENDPOINT
    for flag in ("--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--cpus=1", "--pull=never"):
        assert flag in command
    assert command[command.index("--user") + 1] == "65534:65534"
    assert image_id in command
    assert not any(c in command for c in ("-v", "--volume", "--mount", "--privileged", "--env", "-e"))
    payload = json.loads(input_bytes[0])
    assert payload["files"]["api/example.py"] == "value = 1\n"
    assert ".env" not in payload["files"]
    expected_status = "timed_out" if docker_exit == "timeout" else "passed" if docker_exit == 0 else "blocked"
    assert result["status"] == expected_status and result["truncated"]
    assert result["executed"] is (docker_exit in (0, "timeout"))
    assert len(result["output"]) == MAX_OUTPUT_BYTES
    assert any("rm" in c and c[c.index("rm") + 1] == "-f" for c in commands)
