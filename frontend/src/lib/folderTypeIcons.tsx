import type { FC, SVGProps } from 'react';
import IcFolder from '~icons/vscode-icons/default-folder';
import IcFolderOpen from '~icons/vscode-icons/default-folder-opened';
import FSrc from '~icons/vscode-icons/folder-type-src';
import FSrcO from '~icons/vscode-icons/folder-type-src-opened';
import FApp from '~icons/vscode-icons/folder-type-app';
import FAppO from '~icons/vscode-icons/folder-type-app-opened';
import FLibrary from '~icons/vscode-icons/folder-type-library';
import FLibraryO from '~icons/vscode-icons/folder-type-library-opened';
import FComponent from '~icons/vscode-icons/folder-type-component';
import FComponentO from '~icons/vscode-icons/folder-type-component-opened';
import FHook from '~icons/vscode-icons/folder-type-hook';
import FHookO from '~icons/vscode-icons/folder-type-hook-opened';
import FRedux from '~icons/vscode-icons/folder-type-redux';
import FReduxO from '~icons/vscode-icons/folder-type-redux-opened';
import FConfig from '~icons/vscode-icons/folder-type-config';
import FConfigO from '~icons/vscode-icons/folder-type-config-opened';
import FHelper from '~icons/vscode-icons/folder-type-helper';
import FHelperO from '~icons/vscode-icons/folder-type-helper-opened';
import FServices from '~icons/vscode-icons/folder-type-services';
import FServicesO from '~icons/vscode-icons/folder-type-services-opened';
import FServer from '~icons/vscode-icons/folder-type-server';
import FServerO from '~icons/vscode-icons/folder-type-server-opened';
import FClient from '~icons/vscode-icons/folder-type-client';
import FClientO from '~icons/vscode-icons/folder-type-client-opened';
import FModel from '~icons/vscode-icons/folder-type-model';
import FModelO from '~icons/vscode-icons/folder-type-model-opened';
import FView from '~icons/vscode-icons/folder-type-view';
import FViewO from '~icons/vscode-icons/folder-type-view-opened';
import FController from '~icons/vscode-icons/folder-type-controller';
import FControllerO from '~icons/vscode-icons/folder-type-controller-opened';
import FMiddleware from '~icons/vscode-icons/folder-type-middleware';
import FMiddlewareO from '~icons/vscode-icons/folder-type-middleware-opened';
import FRoute from '~icons/vscode-icons/folder-type-route';
import FRouteO from '~icons/vscode-icons/folder-type-route-opened';
import FTypings from '~icons/vscode-icons/folder-type-typings';
import FTypingsO from '~icons/vscode-icons/folder-type-typings-opened';
import FInterfaces from '~icons/vscode-icons/folder-type-interfaces';
import FInterfacesO from '~icons/vscode-icons/folder-type-interfaces-opened';
import FApi from '~icons/vscode-icons/folder-type-api';
import FApiO from '~icons/vscode-icons/folder-type-api-opened';
import FModule from '~icons/vscode-icons/folder-type-module';
import FModuleO from '~icons/vscode-icons/folder-type-module-opened';
import FShared from '~icons/vscode-icons/folder-type-shared';
import FSharedO from '~icons/vscode-icons/folder-type-shared-opened';
import FCommon from '~icons/vscode-icons/folder-type-common';
import FCommonO from '~icons/vscode-icons/folder-type-common-opened';
import FPlugin from '~icons/vscode-icons/folder-type-plugin';
import FPluginO from '~icons/vscode-icons/folder-type-plugin-opened';
import FStyle from '~icons/vscode-icons/folder-type-style';
import FStyleO from '~icons/vscode-icons/folder-type-style-opened';
import FSass from '~icons/vscode-icons/folder-type-sass';
import FSassO from '~icons/vscode-icons/folder-type-sass-opened';
import FCss from '~icons/vscode-icons/folder-type-css';
import FCssO from '~icons/vscode-icons/folder-type-css-opened';
import FImages from '~icons/vscode-icons/folder-type-images';
import FImagesO from '~icons/vscode-icons/folder-type-images-opened';
import FAsset from '~icons/vscode-icons/folder-type-asset';
import FAssetO from '~icons/vscode-icons/folder-type-asset-opened';
import FPublic from '~icons/vscode-icons/folder-type-public';
import FPublicO from '~icons/vscode-icons/folder-type-public-opened';
import FFonts from '~icons/vscode-icons/folder-type-fonts';
import FFontsO from '~icons/vscode-icons/folder-type-fonts-opened';
import FAudio from '~icons/vscode-icons/folder-type-audio';
import FAudioO from '~icons/vscode-icons/folder-type-audio-opened';
import FVideo from '~icons/vscode-icons/folder-type-video';
import FVideoO from '~icons/vscode-icons/folder-type-video-opened';
import FTheme from '~icons/vscode-icons/folder-type-theme';
import FThemeO from '~icons/vscode-icons/folder-type-theme-opened';
import FDocs from '~icons/vscode-icons/folder-type-docs';
import FDocsO from '~icons/vscode-icons/folder-type-docs-opened';
import FLocale from '~icons/vscode-icons/folder-type-locale';
import FLocaleO from '~icons/vscode-icons/folder-type-locale-opened';
import FTest from '~icons/vscode-icons/folder-type-test';
import FTestO from '~icons/vscode-icons/folder-type-test-opened';
import FE2e from '~icons/vscode-icons/folder-type-e2e';
import FE2eO from '~icons/vscode-icons/folder-type-e2e-opened';
import FCypress from '~icons/vscode-icons/folder-type-cypress';
import FCypressO from '~icons/vscode-icons/folder-type-cypress-opened';
import FMock from '~icons/vscode-icons/folder-type-mock';
import FMockO from '~icons/vscode-icons/folder-type-mock-opened';
import FCoverage from '~icons/vscode-icons/folder-type-coverage';
import FCoverageO from '~icons/vscode-icons/folder-type-coverage-opened';
import FDb from '~icons/vscode-icons/folder-type-db';
import FDbO from '~icons/vscode-icons/folder-type-db-opened';
import FGraphql from '~icons/vscode-icons/folder-type-graphql';
import FGraphqlO from '~icons/vscode-icons/folder-type-graphql-opened';
import FPrisma from '~icons/vscode-icons/folder-type-prisma';
import FPrismaO from '~icons/vscode-icons/folder-type-prisma-opened';
import FDist from '~icons/vscode-icons/folder-type-dist';
import FDistO from '~icons/vscode-icons/folder-type-dist-opened';
import FNode from '~icons/vscode-icons/folder-type-node';
import FNodeO from '~icons/vscode-icons/folder-type-node-opened';
import FPackage from '~icons/vscode-icons/folder-type-package';
import FPackageO from '~icons/vscode-icons/folder-type-package-opened';
import FTemp from '~icons/vscode-icons/folder-type-temp';
import FTempO from '~icons/vscode-icons/folder-type-temp-opened';
import FScript from '~icons/vscode-icons/folder-type-script';
import FScriptO from '~icons/vscode-icons/folder-type-script-opened';
import FTools from '~icons/vscode-icons/folder-type-tools';
import FToolsO from '~icons/vscode-icons/folder-type-tools-opened';
import FDocker from '~icons/vscode-icons/folder-type-docker';
import FDockerO from '~icons/vscode-icons/folder-type-docker-opened';
import FKubernetes from '~icons/vscode-icons/folder-type-kubernetes';
import FKubernetesO from '~icons/vscode-icons/folder-type-kubernetes-opened';
import FWasm from '~icons/vscode-icons/folder-type-wasm';
import FWasmO from '~icons/vscode-icons/folder-type-wasm-opened';
import FCargo from '~icons/vscode-icons/folder-type-cargo';
import FCargoO from '~icons/vscode-icons/folder-type-cargo-opened';
import FWebpack from '~icons/vscode-icons/folder-type-webpack';
import FWebpackO from '~icons/vscode-icons/folder-type-webpack-opened';
import FElectron from '~icons/vscode-icons/folder-type-electron';
import FElectronO from '~icons/vscode-icons/folder-type-electron-opened';
import FNext from '~icons/vscode-icons/folder-type-next';
import FNextO from '~icons/vscode-icons/folder-type-next-opened';
import FTemplate from '~icons/vscode-icons/folder-type-template';
import FTemplateO from '~icons/vscode-icons/folder-type-template-opened';
import FLog from '~icons/vscode-icons/folder-type-log';
import FLogO from '~icons/vscode-icons/folder-type-log-opened';
import FVscode from '~icons/vscode-icons/folder-type-vscode';
import FVscodeO from '~icons/vscode-icons/folder-type-vscode-opened';
import FIdea from '~icons/vscode-icons/folder-type-idea';
import FIdeaO from '~icons/vscode-icons/folder-type-idea-opened';
import FHusky from '~icons/vscode-icons/folder-type-husky';
import FHuskyO from '~icons/vscode-icons/folder-type-husky-opened';
import FDevcontainer from '~icons/vscode-icons/folder-type-devcontainer';
import FDevcontainerO from '~icons/vscode-icons/folder-type-devcontainer-opened';
import FCursor from '~icons/vscode-icons/folder-type-cursor';
import FCursorO from '~icons/vscode-icons/folder-type-cursor-opened';
import FClaude from '~icons/vscode-icons/folder-type-claude';
import FClaudeO from '~icons/vscode-icons/folder-type-claude-opened';
import FGithub from '~icons/vscode-icons/folder-type-github';
import FGithubO from '~icons/vscode-icons/folder-type-github-opened';
import FGit from '~icons/vscode-icons/folder-type-git';
import FGitO from '~icons/vscode-icons/folder-type-git-opened';

type IconCmp = FC<SVGProps<SVGSVGElement>>;
export interface FolderIconPair { closed: IconCmp; open: IconCmp }

/** Default (uncategorised) folder icons. */
export const DEFAULT_FOLDER: FolderIconPair = { closed: IcFolder, open: IcFolderOpen };

// One coloured icon pair per folder category (VS Code "vscode-icons" set).
const ICONS: Record<string, FolderIconPair> = {
  src: { closed: FSrc, open: FSrcO },
  app: { closed: FApp, open: FAppO },
  library: { closed: FLibrary, open: FLibraryO },
  component: { closed: FComponent, open: FComponentO },
  hook: { closed: FHook, open: FHookO },
  redux: { closed: FRedux, open: FReduxO },
  config: { closed: FConfig, open: FConfigO },
  helper: { closed: FHelper, open: FHelperO },
  services: { closed: FServices, open: FServicesO },
  server: { closed: FServer, open: FServerO },
  client: { closed: FClient, open: FClientO },
  model: { closed: FModel, open: FModelO },
  view: { closed: FView, open: FViewO },
  controller: { closed: FController, open: FControllerO },
  middleware: { closed: FMiddleware, open: FMiddlewareO },
  route: { closed: FRoute, open: FRouteO },
  typings: { closed: FTypings, open: FTypingsO },
  interfaces: { closed: FInterfaces, open: FInterfacesO },
  api: { closed: FApi, open: FApiO },
  module: { closed: FModule, open: FModuleO },
  shared: { closed: FShared, open: FSharedO },
  common: { closed: FCommon, open: FCommonO },
  plugin: { closed: FPlugin, open: FPluginO },
  style: { closed: FStyle, open: FStyleO },
  sass: { closed: FSass, open: FSassO },
  css: { closed: FCss, open: FCssO },
  images: { closed: FImages, open: FImagesO },
  asset: { closed: FAsset, open: FAssetO },
  public: { closed: FPublic, open: FPublicO },
  fonts: { closed: FFonts, open: FFontsO },
  audio: { closed: FAudio, open: FAudioO },
  video: { closed: FVideo, open: FVideoO },
  theme: { closed: FTheme, open: FThemeO },
  docs: { closed: FDocs, open: FDocsO },
  locale: { closed: FLocale, open: FLocaleO },
  test: { closed: FTest, open: FTestO },
  e2e: { closed: FE2e, open: FE2eO },
  cypress: { closed: FCypress, open: FCypressO },
  mock: { closed: FMock, open: FMockO },
  coverage: { closed: FCoverage, open: FCoverageO },
  db: { closed: FDb, open: FDbO },
  graphql: { closed: FGraphql, open: FGraphqlO },
  prisma: { closed: FPrisma, open: FPrismaO },
  dist: { closed: FDist, open: FDistO },
  node: { closed: FNode, open: FNodeO },
  package: { closed: FPackage, open: FPackageO },
  temp: { closed: FTemp, open: FTempO },
  script: { closed: FScript, open: FScriptO },
  tools: { closed: FTools, open: FToolsO },
  docker: { closed: FDocker, open: FDockerO },
  kubernetes: { closed: FKubernetes, open: FKubernetesO },
  wasm: { closed: FWasm, open: FWasmO },
  cargo: { closed: FCargo, open: FCargoO },
  webpack: { closed: FWebpack, open: FWebpackO },
  electron: { closed: FElectron, open: FElectronO },
  next: { closed: FNext, open: FNextO },
  template: { closed: FTemplate, open: FTemplateO },
  log: { closed: FLog, open: FLogO },
  vscode: { closed: FVscode, open: FVscodeO },
  idea: { closed: FIdea, open: FIdeaO },
  husky: { closed: FHusky, open: FHuskyO },
  devcontainer: { closed: FDevcontainer, open: FDevcontainerO },
  cursor: { closed: FCursor, open: FCursorO },
  claude: { closed: FClaude, open: FClaudeO },
  github: { closed: FGithub, open: FGithubO },
  git: { closed: FGit, open: FGitO },
};

// Folder name (lowercased) -> category key. Exact-match lookup.
const ALIAS: Record<string, string> = {
  'src': 'src', 'source': 'src', 'sources': 'src',
  'app': 'app', 'apps': 'app',
  'lib': 'library', 'libs': 'library', 'library': 'library', 'libraries': 'library',
  'components': 'component', 'component': 'component', 'widgets': 'component', 'widget': 'component',
  'hooks': 'hook', 'hook': 'hook',
  'store': 'redux', 'stores': 'redux', 'state': 'redux', 'redux': 'redux', 'zustand': 'redux',
  'config': 'config', 'configs': 'config', 'configuration': 'config', 'settings': 'config',
  'utils': 'helper', 'util': 'helper', 'utilities': 'helper', 'helpers': 'helper', 'helper': 'helper',
  'services': 'services', 'service': 'services',
  'server': 'server', 'backend': 'server',
  'client': 'client', 'frontend': 'client',
  'models': 'model', 'model': 'model', 'entities': 'model', 'entity': 'model',
  'views': 'view', 'view': 'view',
  'controllers': 'controller', 'controller': 'controller',
  'middleware': 'middleware', 'middlewares': 'middleware',
  'routes': 'route', 'route': 'route', 'router': 'route', 'routers': 'route',
  'types': 'typings', 'typings': 'typings',
  'interfaces': 'interfaces', 'interface': 'interfaces',
  'api': 'api', 'apis': 'api',
  'modules': 'module',
  'shared': 'shared',
  'common': 'common',
  'plugins': 'plugin', 'plugin': 'plugin',
  'styles': 'style', 'style': 'style',
  'sass': 'sass', 'scss': 'sass',
  'css': 'css',
  'images': 'images', 'image': 'images', 'img': 'images', 'icons': 'images', 'icon': 'images', 'pics': 'images', 'pictures': 'images',
  'assets': 'asset', 'asset': 'asset', 'resources': 'asset', 'resource': 'asset',
  'public': 'public', 'static': 'public',
  'fonts': 'fonts', 'font': 'fonts',
  'audio': 'audio', 'sounds': 'audio', 'sound': 'audio', 'music': 'audio',
  'video': 'video', 'videos': 'video', 'movies': 'video', 'movie': 'video',
  'themes': 'theme', 'theme': 'theme',
  'docs': 'docs', 'doc': 'docs', 'documentation': 'docs',
  'locale': 'locale', 'locales': 'locale', 'i18n': 'locale', 'lang': 'locale', 'languages': 'locale', 'translations': 'locale',
  'test': 'test', 'tests': 'test', '__tests__': 'test', 'spec': 'test', 'specs': 'test',
  'e2e': 'e2e',
  'cypress': 'cypress',
  'mocks': 'mock', 'mock': 'mock', '__mocks__': 'mock', 'fixtures': 'mock', 'fixture': 'mock',
  'coverage': 'coverage',
  'db': 'db', 'database': 'db',
  'graphql': 'graphql', 'gql': 'graphql',
  'prisma': 'prisma',
  'dist': 'dist', 'build': 'dist', 'out': 'dist', 'output': 'dist',
  'node_modules': 'node', 'vendor': 'node', 'vendors': 'node',
  'packages': 'package', 'package': 'package',
  'temp': 'temp', 'tmp': 'temp', 'cache': 'temp',
  'scripts': 'script', 'script': 'script',
  'tools': 'tools', 'tooling': 'tools',
  'docker': 'docker',
  'kubernetes': 'kubernetes', 'k8s': 'kubernetes',
  'wasm': 'wasm',
  'cargo': 'cargo', 'crates': 'cargo',
  'webpack': 'webpack',
  'electron': 'electron',
  'next': 'next',
  'templates': 'template', 'template': 'template',
  'logs': 'log', 'log': 'log',
  '.vscode': 'vscode',
  '.idea': 'idea',
  '.husky': 'husky',
  '.devcontainer': 'devcontainer',
  '.cursor': 'cursor',
  '.claude': 'claude',
  '.github': 'github',
  '.git': 'git',
};

/** Resolve a coloured icon pair for a directory name; DEFAULT_FOLDER when unknown.
 *  Exact alias match first, then a couple of shape-based fallbacks (e.g. `unit-tests`). */
export function folderTypeIcons(name: string): FolderIconPair {
  const n = name.toLowerCase();
  const key = ALIAS[n];
  if (key) return ICONS[key];
  // Fallbacks for common suffixed/compound names the exact map can't enumerate.
  if (/(^|[-_.])tests?$/.test(n) || /(^|[-_.])specs?$/.test(n)) return ICONS.test;
  if (/(^|[-_.])config$/.test(n) || n.endsWith('.config')) return ICONS.config;
  if (n.endsWith('-service') || n.endsWith('-services')) return ICONS.services;
  return DEFAULT_FOLDER;
}

