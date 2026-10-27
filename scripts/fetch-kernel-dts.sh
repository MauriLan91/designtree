#!/bin/sh
# Sparse checkout of the parts of the Linux kernel the G1 round-trip corpus
# needs (devicetree sources, dt-bindings headers), at a pinned tag.
#
#   scripts/fetch-kernel-dts.sh [DIR]    DIR defaults to ~/linux-g1
#
# Then: DESIGNTREE_LINUX_SRC=DIR cargo test -p designtree-core --test g1_corpus -- --ignored --nocapture
# Bump KERNEL_TAG (and re-run the corpus) to move to another release.
set -eu

KERNEL_TAG="${KERNEL_TAG:-v7.3}"
DIR="${1:-$HOME/linux-g1}"

if [ -d "$DIR/.git" ]; then
    git -C "$DIR" fetch --quiet --depth 1 origin "refs/tags/$KERNEL_TAG:refs/tags/$KERNEL_TAG"
    git -C "$DIR" checkout --quiet "$KERNEL_TAG"
else
    git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$KERNEL_TAG" \
        https://github.com/torvalds/linux.git "$DIR"
fi
# include/uapi/linux holds the input event codes that dt-bindings/input links to.
git -C "$DIR" sparse-checkout set \
    arch/arm/boot/dts arch/arm64/boot/dts \
    include/dt-bindings include/uapi/linux \
    scripts/dtc/include-prefixes
echo "kernel $KERNEL_TAG in $DIR"
