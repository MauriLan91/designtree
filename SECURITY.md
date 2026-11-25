# Security policy

## Supported versions

Security fixes go into `main` and the next release. Only the latest release
is supported; please update before reporting.

## Reporting a vulnerability

Please do **not** open a public issue, discussion or pull request for a
security problem.

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/MauriLan91/designtree/security/advisories/new)
(Security tab > Advisories > Report a vulnerability). Only the maintainer can
see the report.

Please include:

- the DesignTree version (or commit) and how it was installed
- what an attacker can do, and the steps or a file that reproduces it
- any suggested fix, if you have one

## What to expect

DesignTree is maintained by one person, so these are goals, not guarantees:

- an acknowledgement within 7 days
- an assessment, and a plan or a fix, within 30 days
- credit in the advisory and the release notes, unless you prefer otherwise

We will tell you before the advisory is published and coordinate the date
with you.

## Scope

DesignTree reads untrusted input: `.dts`, `.dtsi` and `.dtb` files, design
files and kernel binding schemas. Issues of particular interest:

- reading files outside the allowed include locations (the file's directory,
  its kernel tree and `-I` directories)
- running commands, or passing input to `dtc` or `cpp` in a way that escapes
  the intended invocation
- crashes, hangs or unbounded memory use from a crafted input file that get
  past the parser's size and nesting limits
- problems in the release packages or the build pipeline that produces them

Bugs in `dtc`, the Linux kernel or their binding schemas belong to those
projects.
