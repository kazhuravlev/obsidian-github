import {App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder} from 'obsidian';
import {requestUrl, RequestUrlParam} from 'obsidian';

// Remember to rename these classes and interfaces!

interface GitHubPluginSettings {
	apiToken: string;
	username: string;
	targetDirectory: string;
}

const DEFAULT_SETTINGS: GitHubPluginSettings = {
	apiToken: '',
	username: '',
	targetDirectory: '',
}

interface StarredRepo {
	name: string;
	full_name: string;
	html_url: string;
	description: string;
	created_at: string;
	updated_at: string;
	language: string;
	stargazers_count: number;
	owner: {
		login: string;
		avatar_url: string;
	};
}

export default class GitHubPlugin extends Plugin {
	settings: GitHubPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('star', 'Fetch GitHub Stars', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			await this.fetchStars();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('github-plugin-ribbon-class');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'fetch-github-stars',
			name: 'Fetch GitHub Stars',
			callback: async () => {
				await this.fetchStars();
			}
		});

		this.addCommand({
			id: 'open-github-modal-simple',
			name: 'Open GitHub modal',
			callback: () => {
				new GitHubModal(this.app).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GitHubSettingTab(this.app, this));

		// Check if settings are ready to fetch stars when plugin loads
		if (this.settingsAreValid()) {
			this.fetchStars();
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	settingsAreValid(): boolean {
		return Boolean(
			this.settings.username &&
			this.settings.targetDirectory
		);
	}

	async fetchStars() {
		if (!this.settingsAreValid()) {
			new Notice('Please set both GitHub username and target directory in settings');
			return;
		}

		try {
			// Ensure target directory exists
			await this.ensureTargetDirectoryExists();

			// Fetch starred repositories
			let reposCount = 0;
			let page = 1;
			while (true) {
				const response = await this.getStarredRepos(page);

				for (const repo of response.stars) {
					await this.createNoteForRepo(repo);
					reposCount++;
				}

				new Notice(`Fetched ${reposCount} GitHub stars`);
				if (!response.hasMore) {
					break
				}

				page++;
			}

			new Notice(`Total ${reposCount} GitHub stars`);
		} catch (error) {
			console.error('Error fetching GitHub stars:', error);
			new Notice(`Error fetching GitHub stars: ${error.message}`);
		}
	}

	async ensureTargetDirectoryExists() {
		const {vault} = this.app;
		const dirs = this.settings.targetDirectory.split('/').filter(p => p.trim());

		let currentPath = '';
		for (const dir of dirs) {
			currentPath = currentPath ? `${currentPath}/${dir}` : dir;
			if (!(await vault.adapter.exists(currentPath))) {
				await vault.createFolder(currentPath);
			}
		}
	}

	async getStarredRepos(page: number): Promise<{ stars: StarredRepo[], hasMore: boolean }> {
		const {apiToken, username} = this.settings;
		const perPage = 100;

		const params: RequestUrlParam = {
			url: `https://api.github.com/users/${username}/starred?per_page=${perPage}&page=${page}`,
			method: 'GET',
			headers: {
				'Accept': 'application/vnd.github.v3+json',
				'User-Agent': 'Obsidian-GitHub-Plugin'
			}
		};

		if (apiToken) {
			params.headers = {
				...params.headers,
				'Authorization': `token ${apiToken}`
			};
		}

		const response = await requestUrl(params);
		const stars = response.json as StarredRepo[];

		return {stars: stars, hasMore: stars.length == perPage}
	}

	async createNoteForRepo(repo: StarredRepo) {
		const {vault} = this.app;
		const fileName = `${this.settings.targetDirectory}/${repo.full_name.replace('/', '-')}.md`;

		const fileContent = `# ${repo.name}
> ${repo.description || 'No description'}

- **URL**: [${repo.html_url}](${repo.html_url})
- **Owner**: [${repo.owner.login}](https://github.com/${repo.owner.login})
- **Language**: ${repo.language || 'Not specified'}
- **Stars**: ${repo.stargazers_count}
- **Created**: ${new Date(repo.created_at).toLocaleDateString()}
- **Updated**: ${new Date(repo.updated_at).toLocaleDateString()}

## Description
${repo.description || 'No description provided.'}

---
Fetched via Obsidian GitHub Plugin on ${new Date().toLocaleString()}
`;

		try {
			if (await vault.adapter.exists(fileName)) {
				await vault.adapter.write(fileName, fileContent);
			} else {
				await vault.create(fileName, fileContent);
			}
		} catch (error) {
			console.error(`Error creating note for ${repo.name}:`, error);
		}
	}
}

class GitHubModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class GitHubSettingTab extends PluginSettingTab {
	plugin: GitHubPlugin;

	constructor(app: App, plugin: GitHubPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('GitHub API Token')
			.setDesc('Personal access token (https://github.com/settings/personal-access-tokens) with Starring::read')
			.addText(text => text
				.setPlaceholder('Enter your PAT')
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (value) => {
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
					this.checkAndFetchStars();
				}));

		new Setting(containerEl)
			.setName('GitHub Username')
			.setDesc('Your GitHub username')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
					this.checkAndFetchStars();
				}));

		new Setting(containerEl)
			.setName('Target Directory')
			.setDesc('Directory where GitHub data will be stored')
			.addText(text => text
				.setPlaceholder('Enter target directory')
				.setValue(this.plugin.settings.targetDirectory)
				.onChange(async (value) => {
					this.plugin.settings.targetDirectory = value;
					await this.plugin.saveSettings();
					this.checkAndFetchStars();
				}));

		new Setting(containerEl)
			.setName('Fetch Stars Now')
			.setDesc('Manually trigger fetching starred repositories')
			.addButton(button => button
				.setButtonText('Fetch Stars')
				.setCta()
				.onClick(async () => {
					await this.plugin.fetchStars();
				}));
	}

	checkAndFetchStars(): void {
		if (this.plugin.settingsAreValid()) {
			const notice = new Notice('Settings updated. Fetching GitHub stars...', 3000);
			setTimeout(() => {
				this.plugin.fetchStars();
			}, 1000);
		}
	}
}
