#!/usr/bin/env python3
import argparse
import json
import urllib.error
import urllib.parse
import urllib.request


AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
SCOPES = "offline_access Files.Read"


def build_auth_url(client_id, redirect_uri):
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": SCOPES,
    }
    return AUTH_URL + "?" + urllib.parse.urlencode(params)


def exchange_code(client_id, client_secret, redirect_uri, code):
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
    }
    request = urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode(data).encode("utf-8"), method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Token exchange failed: HTTP {error.code}\n{body}") from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret")
    parser.add_argument("--redirect-uri", default="http://localhost")
    parser.add_argument("--code")
    parser.add_argument("--save-json")
    args = parser.parse_args()

    if not args.code:
        print(build_auth_url(args.client_id, args.redirect_uri))
        return

    if not args.client_secret:
        raise SystemExit("--client-secret is required when exchanging an authorization code")

    payload = exchange_code(args.client_id, args.client_secret, args.redirect_uri, args.code)
    result = {
        "access_token_present": bool(payload.get("access_token")),
        "refresh_token": payload.get("refresh_token"),
        "expires_in": payload.get("expires_in"),
        "scope": payload.get("scope"),
    }
    if args.save_json:
        with open(args.save_json, "w", encoding="utf-8") as token_file:
            json.dump(payload, token_file)
        result["saved_json"] = args.save_json
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
