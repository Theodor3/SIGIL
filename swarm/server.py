import argparse
import logging

import uvicorn

from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="Start the local SIGIL swarm dashboard.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir")
    args = parser.parse_args()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    uvicorn.run(create_app(args.data_dir), host="127.0.0.1", port=args.port, workers=1,
                access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
