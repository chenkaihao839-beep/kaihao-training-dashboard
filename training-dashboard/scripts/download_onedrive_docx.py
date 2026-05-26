#!/usr/bin/env python3
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
GRAPH_ROOT = "https://graph.microsoft.com/v1.0"


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def request_access_token():
    data = {
        "client_id": require_env("MS_CLIENT_ID"),
        "client_secret": require_env("MS_CLIENT_SECRET"),
        "refresh_token": require_env("MS_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    }
    body = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(TOKEN_URL, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Token refresh failed: HTTP {error.code}\n{body}") from error
    if "access_token" not in payload:
        raise SystemExit(f"Token response did not include access_token: {payload}")
    return payload["access_token"]


def download_file(access_token, one_drive_path, output_path, optional=False):
    encoded_path = urllib.parse.quote(one_drive_path.strip("/"))
    url = f"{GRAPH_ROOT}/me/drive/root:/{encoded_path}:/content"
    request = urllib.request.Request(url)
    request.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urllib.request.urlopen(request) as response:
            output_path.write_bytes(response.read())
    except urllib.error.HTTPError as error:
        if optional and error.code == 404:
            print(f"Optional OneDrive file not found: {one_drive_path}")
            return False
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"OneDrive download failed: HTTP {error.code}\n{body}") from error
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--onedrive-path", default=os.environ.get("ONEDRIVE_DOCX_PATH", "训练/00_当前Cycle训练记录.docx"))
    parser.add_argument("--output", default="current-training.docx", type=Path)
    parser.add_argument("--optional", action="store_true")
    args = parser.parse_args()

    token = request_access_token()
    downloaded = download_file(token, args.onedrive_path, args.output, args.optional)
    if downloaded:
        print(f"Downloaded OneDrive file to {args.output}")


if __name__ == "__main__":
    main()
