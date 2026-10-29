"""Explicit controller-only CLI; no worker tools or settings are installed."""
import argparse
import json
from .notebook import NotebookError, retrieve_notebook


def main():
    parser = argparse.ArgumentParser(description='Read bounded Sigil notes into an untrusted local review packet.')
    parser.add_argument('--notebook', required=True, help='Explicit approved Sigil Notebook directory, not the vault root')
    parser.add_argument('--query', required=True)
    args = parser.parse_args()
    try:
        packet = retrieve_notebook(args.notebook, args.query)
    except NotebookError as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps(packet, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
