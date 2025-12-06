#!/bin/bash

# DEPRECATED: This script is deprecated and will be removed in a future release.
# 
# Please use the unified setup script instead:
#   ./setup.sh --type gcloud
#
# This script is preserved temporarily for backward compatibility.

echo "⚠️  DEPRECATION WARNING: create.sh is deprecated"
echo "   Please use: ./setup.sh --type gcloud"
echo "   This script will be removed in a future release."
echo ""
echo "Redirecting to unified setup script..."
echo ""

exec ./setup.sh --type gcloud "$@"
