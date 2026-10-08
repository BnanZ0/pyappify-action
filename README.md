# PyAppify Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-PyAppify%20Action-blue.svg?colorA=24292e&colorB=0366d6&style=flat&logo=github)](https://github.com/marketplace/actions/pyappify)

This GitHub Action uses [PyAppify](https://github.com/ok-oldking/pyappify) to compile and package your Python application into cross-platform, standalone executables directly within your workflow.

## Prerequisites

Before using this action, you must have a `pyappify.yml` configuration file in the root of your repository. You may also include an optional `icons` directory for custom application icons.

* pyappify.yml
* icons
  * icon.ico
  * icon.png


### `pyappify.yml`

This file defines your application's name and its build profiles.

**Example `pyappify.yml`:**

```yaml
name: "pyappify-sample" # English only
profiles:
  - name: "release_正式版" # can use Unicode chars
    git_url: "https://github.com/ok-oldking/pyappify-action.git" # the repo url to clone, must have tags for the version management, semver is recommended
    main_script: "main.py" # if ending with .py will use python venv to run, else will search in the working dir and the venv's Script/bin path
    requires_python: "3.12" # supports python 3.7 - 3.13
    requirements: "requirements.txt"  # support using a *.txt or pyproject.toml's .[dev,docs]
    pip_args: "--index-url https://mirrors.cloud.tencent.com/pypi/simple" # optional

  - name: "debug" # can use Unicode chars
    main_script: "main_debug.py" # you can omit other properties, will use the first profile's as default
    pip_args: "-i https://mirrors.aliyun.com/pypi/simple" # optional
```

## Inputs

| Input     | Description                                                                                               | Default        | Required |
|-----------|-----------------------------------------------------------------------------------------------------------|----------------|----------|
| `version` | The tag version of pyappify to use (e.g., `v0.1.0`). It is highly recommended to pin a version for consistency. You can checkout the versions at https://github.com/ok-oldking/pyappify/releases | `latest` tag | `false`  |

## Usage Example

This example demonstrates how to build your application on Windows, macOS, and Ubuntu(Currently only support windows), and then release the resulting packages. 

```yaml
name: Build Application

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        platform: [windows-latest] # will support ubuntu-latest, macos-latest in the future
    runs-on: ${{ matrix.platform }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Build with PyAppify Action
        id: build-app
        uses: ok-oldking/pyappify-action@master
        with:
          version: 'v0.1.0' # Optional: Pin the PyAppify version, you can checkout the version at https://github.com/ok-oldking/pyappify/releases
          use_release: 'https://api.github.com/repos/ok-oldking/pyappify-action/releases/tags/v1.0.0' # Optional: Use a existing release's assets to skip the building process, use when you didn't change the icons and the pyappify.yml

      - name: Release
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          body: | 
            Your Release Note
          files: pyappify_dist/*
```

## How It Works

The action automates the following steps:
1.  Clones the PyAppify repository.
2.  Reads your local `pyappify.yml` to get your application's name and build profiles.
3.  Copies your configuration and `icons` directory into the PyAppify source tree.
4.  Updates the PyAppify project files with your application's name.
5.  Builds the application binary using Tauri.
6.  Packages the final application, creating a separate zipped bundle for each profile defined in your configuration file.
7.  Outputs the path to the directory containing the generated artifacts.
## Frozen PyInstaller packages

Configure the packaging directory at the root of your application's `pyappify.yml`:

```yaml
packaging: packaging
```

The directory must contain exactly one `.spec` and `requirements-build.txt` (or `requirements.txt`).
The spec stem must match the onedir and executable names: `ok-nte.spec` produces
`dist/ok-nte/ok-nte.exe`. An optional `build.ps1` in this directory is called for
application-specific resources and build environment handling. Otherwise, PyAppify
runs the discovered spec with the application's virtual environment.

The Action builds the launcher or reuses its existing executable, then directly calls
`-c frozen-zip`. PyAppify installs application dependencies with `uv sync --locked --no-dev`,
installs build dependencies, builds the application, and generates both ZIPs.
Set up Python and uv before calling the Action.

```yaml
- name: Build with PyAppify Action
  uses: BnanZ0/pyappify-action@master
  with:
    package_mode: frozen
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Select `package_mode: setup` (the default), `frozen`, or `all`.
`frozen` always generates the body ZIP and also generates the full ZIP when
MirrorChyan is configured; `all` additionally generates the existing setup installers.
The launcher selects the ZIPs from the application configuration; the Action calls
the same `frozen-zip` command in both cases.
The `version` input selects the PyAppify tag; omitting it uses the latest tag.
Frozen builds currently require Windows. `use_release` works the same way as in setup
mode: the Action reuses the release executable and calls its command directly.
The reused launcher must implement `frozen-zip`; no capability preflight is performed.
`build_exe_only` stops after building the launcher.

The application version comes from `GITHUB_REF_NAME`; run frozen packaging on a release tag.
The outputs are:

| Output | ZIP | Contents |
| --- | --- | --- |
| `full-zip-path` (only with MirrorChyan) | `<application>-win-x86_64-v<version>-full.zip` | Launcher and frozen body under `data/apps/<application>/working/` |
| `body-zip-path` | `<application>-win-x86_64-v<version>-body.zip` | Application EXE, `_internal`, external resources, YAML and `pyappify-files.json` at the ZIP root |

Generated files are written to `pyappify_dist` and included in `pyappify-assets`.
The filename uses the runner architecture (`x64` becomes `x86_64`) and includes
the release version without duplicating an existing `v` prefix.
The full ZIP reuses exactly the same body and manifest as the body ZIP.

Full ZIPs preserve the original MirrorChyan launcher installation and require
a valid MirrorChyan resource ID. Without MirrorChyan configuration, only the body ZIP
is generated and `full-zip-path` is not set.
For full packaging, configure:

```yaml
packaging: packaging
update_source: mirrorchyan
mirrorchyan:
  resource_id: YOUR_RESOURCE_ID
  stable_channel: stable
```

Full packaging sets `update_source: mirrorchyan` in the packaged YAML, as before.
MirrorChyan resource IDs and channels belong to the updater configuration,
not the packaging directory.
The old `mirror` mode, `mirror-zip` command, `mirror-zip-path` output and
`mirrorchyan.packaging` configuration are not supported.
