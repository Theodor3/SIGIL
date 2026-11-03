"""Explicit private-volume input; never searches the app or public asset tree."""
import json
from pathlib import Path

from api.research.recovered_daily import MAX_BYTES, PreparedRecovery

PRIVATE_RECOVERY = Path('/data/private/recovered-daily-v1')


def load_recovery(root=PRIVATE_RECOVERY):
    """Revalidate bounded source files on manual reads; no startup IO or writes.

    The binding is an operator-selected account fingerprint, not a credential or
    independent authentication of the receipt. Invalid configuration stays hidden.
    """
    try:
        def read(name):
            path = root / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('invalid_private_input')
            with path.open('rb') as stream:
                data = stream.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError('oversized_private_input')
            return data
        binding = read('account-binding.txt').decode('ascii').strip()
        receipt = json.loads(read('receipt.json'))
        return PreparedRecovery(read('view.json'), read('source.json'),
            receipt=receipt, expected_account_fingerprint=binding)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return None
