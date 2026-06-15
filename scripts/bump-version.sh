#!/bin/bash
# 读取当前版本并递增 patch 号
PKG=$(cat package.json)
VERSION=$(echo "$PKG" | grep -o '"version": "[0-9]*\.[0-9]*\.[0-9]*"' | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*')
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
PATCH=$(echo "$VERSION" | cut -d. -f3)
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

# 用 sed 原地替换
sed -i '' "s/\"version\": \"${MAJOR}\.${MINOR}\.${PATCH}\"/\"version\": \"${NEW_VERSION}\"/" package.json

echo "📦 Version bumped to ${NEW_VERSION}"
