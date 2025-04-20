# GitHub Integration

This Obsidian plugin imports your starred GitHub repositories into your Obsidian vault as notes with rich metadata. Keep track of interesting repositories directly in your knowledge base!

## Features

- Import all starred repositories from your GitHub account
- Create notes with comprehensive repository metadata
- Organize repositories with automatic tagging (language, topics)
- Update notes with the latest repository information
- Only fetch new stars since last update (incremental updates)

## Installation

1. Search for "GitHub Integration" in Obsidian's community plugins browser
2. Install the plugin
3. Enable the plugin

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/YourUsername/obsidian-github-stars/releases)
2. Extract the files to your vault's plugins folder: `<vault>/.obsidian/plugins/obsidian-github-stars/`
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

## Usage

### Configuration

1. Go to Settings → GitHub Integration
2. Enter your GitHub username
3. (Optional) Add a GitHub Personal Access Token for higher API rate limits
4. Set a target directory where your star notes will be stored
5. Click "Sync Stars" button to start sync immediately

### Note Format

Each starred repository is saved as a note with the following frontmatter:

```yaml
---
tags:
  - type/github-star
  - github/language/javascript
  - github/topic/obsidian
aliases: repo-name
description: Repository description
url: https://github.com/user/repo
owner: https://github.com/user
language: JavaScript
stars: 123
created: 2023-01-01
modified: 2023-06-15
lastUpdated: 6/15/2023, 3:45:00 PM
---
```

## Security Note

If you choose to use a GitHub API token, it will be stored in your Obsidian config. While this is generally secure, please be aware of the risks if you share your vault or config files.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Development

### Prerequisites

- Node.js >= 16
- npm or yarn

### Setup

1. Clone this repository
2. Run `npm install` or `yarn` to install dependencies
3. Run `npm run dev` to start compilation in watch mode

### Building

- Run `npm run build` to build the production version

## Credits

- Built for [Obsidian](https://obsidian.md)

## Support

If you encounter any issues or have feature requests, please create an issue on the [GitHub repository](https://github.com/kazhuravlev/obsidian-github).
