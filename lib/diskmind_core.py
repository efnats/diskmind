"""
diskmind-core — Shared library for diskmind components.

Provides common utilities used by both diskmind-fetch and diskmind-view.
"""

VERSION = '1.5'


def parse_simple_yaml(text: str) -> dict:
    """Parse simple YAML (flat keys, string values, simple lists, one level of nesting).

    Supports:
      - Top-level scalar keys:  ``key: value``
      - Top-level lists:        indented ``- item`` lines below a key
      - One-level nested maps:  indented ``subkey: value`` lines below a key

    No external YAML library required.
    """
    result = {}
    current_key = None
    current_list = None

    for raw_line in text.split('\n'):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        indent = len(raw_line) - len(raw_line.lstrip())

        if indent > 0 and current_key and stripped.startswith('- '):
            val = stripped[2:].strip()
            if current_list is None:
                current_list = []
                result[current_key] = current_list
            current_list.append(val)

        elif indent > 0 and current_key and ':' in stripped:
            k, _, v = stripped.partition(':')
            v = v.strip()
            if not isinstance(result.get(current_key), dict):
                result[current_key] = {}
            if v:
                try:
                    result[current_key][k.strip()] = int(v)
                except ValueError:
                    result[current_key][k.strip()] = v

        elif ':' in stripped and indent == 0:
            k, _, v = stripped.partition(':')
            k = k.strip()
            v = v.strip()
            current_key = k
            current_list = None
            if v:
                try:
                    result[k] = int(v)
                except ValueError:
                    result[k] = v

    return result
