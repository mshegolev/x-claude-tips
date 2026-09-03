#!/bin/bash

# LEGACY (pre-v2 schema, not wired into collect.js): starts the server
# with ROD_BROWSER_BIN pointing at Firefox. x-session.sh documents this
# exact configuration as fatal -- rod dies before any network call.
# Needs updating before use.

# Script to diagnose and fix x-browser-mcp Firefox issues

echo "=== Diagnosing x-browser-mcp Firefox Issues ==="

# Check if server is running
echo "1. Checking if x-browser-mcp server is running..."
if curl -s http://127.0.0.1:18110/health > /dev/null; then
  echo "   ✓ Server is running"
else
  echo "   ✗ Server is not running"
  echo "   Starting server with Firefox support..."
  cd ~/.config/opencode/tools/x-browser-mcp
  ROD_BROWSER_BIN="/Applications/Firefox.app/Contents/MacOS/firefox" \
    ./x-browser-mcp -port :18110 -headless=false &
  sleep 3
fi

# Check login status
echo "2. Checking login status..."
LOGIN_STATUS=$(curl -s http://127.0.0.1:18110/api/v1/login/status)
echo "   Login status: $LOGIN_STATUS"

# Try to initiate login
if echo "$LOGIN_STATUS" | grep -q "logged_in.*false"; then
  echo "3. Initiating login process..."
  LOGIN_RESULT=$(curl -s -X POST http://127.0.0.1:18110/api/v1/login/start)
  echo "   Login result: $LOGIN_RESULT"
  
  if echo "$LOGIN_RESULT" | grep -q "browser opened"; then
    echo "   ✓ Browser opened for login"
    echo "   Please log in to X (Twitter) in the Firefox window and close it when done."
    echo "   After closing the browser, press Enter to continue..."
    read -p "   Press Enter when ready... " _
  fi
fi

# Check login status again
echo "4. Checking login status after login attempt..."
LOGIN_STATUS=$(curl -s http://127.0.0.1:18110/api/v1/login/status)
echo "   Login status: $LOGIN_STATUS"

# Test search
echo "5. Testing search functionality..."
SEARCH_RESULT=$(curl -s -X POST http://127.0.0.1:18110/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"opencode","mode":"latest","limit":1}')
echo "   Search result: $SEARCH_RESULT"

echo "=== Diagnosis Complete ==="