# The paper's running example bug: Duration.parse("1h30m") ignores the
# minutes component and returns 3600 instead of 5400.
import re


def parse(text):
    match = re.match(r"^(?:(\d+)h)?(?:(\d+)m)?$", text)
    if not match:
        raise ValueError(f"invalid duration: {text}")
    hours = int(match.group(1) or 0)
    return hours * 3600
