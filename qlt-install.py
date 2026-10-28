"""Install Qualinaut 0.5.3.0 from its GitHub release. Written by `qlt ci`; commit it.

The pipeline runs it instead of `pip install git+...`: no clone of the Qualinaut
repository and no write access are needed, only a token that can read its releases.
Set QLT_GITHUB_TOKEN as a CI secret: a fine-grained token with "Contents: read" on
RomanDiachenko/qualinaut (GH_TOKEN works too).

Usage: python qlt-install.py [extras]      e.g. python qlt-install.py docs,mobile
"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

REPO = "RomanDiachenko/qualinaut"
TAG = "v0.5.3.0"
API = "https://api.github.com/repos/" + REPO


class _DropAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    # The file itself is served from storage that refuses a second credential.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.remove_header("Authorization")
        return new


def fetch(url, token, accept):
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
    })
    return urllib.request.build_opener(_DropAuthOnRedirect).open(request, timeout=120)


def main():
    token = os.environ.get("QLT_GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        sys.exit("set QLT_GITHUB_TOKEN: a token that can read " + REPO + " (Contents: read)")
    try:
        answer = fetch(API + "/releases/tags/" + TAG, token, "application/vnd.github+json")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 404):  # GitHub answers 404 for a repository not visible
            sys.exit(
                "QLT_GITHUB_TOKEN cannot read release " + TAG + " of " + REPO + " (HTTP "
                + str(error.code) + "): give the token access to that repository, with "
                "Contents: read (fine-grained: Repository access > Only select repositories)"
            )
        raise
    with answer:
        release = json.load(answer)
    wheels = [a for a in release.get("assets", []) if a["name"].endswith(".whl")]
    if not wheels:
        sys.exit("release " + TAG + " of " + REPO + " has no wheel attached")
    path = os.path.join(tempfile.mkdtemp(), wheels[0]["name"])
    with fetch(wheels[0]["url"], token, "application/octet-stream") as answer:
        with open(path, "wb") as out:
            out.write(answer.read())
    extras = sys.argv[1] if len(sys.argv) > 1 else ""
    spec = path + "[" + extras + "]" if extras else path
    sys.exit(subprocess.call([sys.executable, "-m", "pip", "install", spec]))


if __name__ == "__main__":
    main()
