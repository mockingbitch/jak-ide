import type { FC, SVGProps } from 'react';
import { folderTypeIcons } from '../lib/folderTypeIcons';

// Real, multi-colour file-type icons (VS Code "vscode-icons" set), tree-shaken
// by unplugin-icons — only the icons imported here end up in the bundle.
import IcDefault from '~icons/vscode-icons/default-file';
import IcTs from '~icons/vscode-icons/file-type-typescript';
import IcTsDef from '~icons/vscode-icons/file-type-typescriptdef';
import IcTsx from '~icons/vscode-icons/file-type-reactts';
import IcJs from '~icons/vscode-icons/file-type-js';
import IcJsx from '~icons/vscode-icons/file-type-reactjs';
import IcJson from '~icons/vscode-icons/file-type-json';
import IcPy from '~icons/vscode-icons/file-type-python';
import IcGo from '~icons/vscode-icons/file-type-go';
import IcPhp from '~icons/vscode-icons/file-type-php';
import IcRb from '~icons/vscode-icons/file-type-ruby';
import IcRs from '~icons/vscode-icons/file-type-rust';
import IcJava from '~icons/vscode-icons/file-type-java';
import IcKt from '~icons/vscode-icons/file-type-kotlin';
import IcC from '~icons/vscode-icons/file-type-c';
import IcH from '~icons/vscode-icons/file-type-cheader';
import IcCpp from '~icons/vscode-icons/file-type-cpp';
import IcCs from '~icons/vscode-icons/file-type-csharp';
import IcCss from '~icons/vscode-icons/file-type-css';
import IcScss from '~icons/vscode-icons/file-type-scss';
import IcLess from '~icons/vscode-icons/file-type-less';
import IcHtml from '~icons/vscode-icons/file-type-html';
import IcVue from '~icons/vscode-icons/file-type-vue';
import IcSvelte from '~icons/vscode-icons/file-type-svelte';
import IcYaml from '~icons/vscode-icons/file-type-yaml';
import IcMd from '~icons/vscode-icons/file-type-markdown';
import IcSh from '~icons/vscode-icons/file-type-shell';
import IcSql from '~icons/vscode-icons/file-type-sql';
import IcXml from '~icons/vscode-icons/file-type-xml';
import IcToml from '~icons/vscode-icons/file-type-toml';
import IcIni from '~icons/vscode-icons/file-type-ini';
import IcSvg from '~icons/vscode-icons/file-type-svg';
import IcImg from '~icons/vscode-icons/file-type-image';
import IcDocker from '~icons/vscode-icons/file-type-docker';
import IcNpm from '~icons/vscode-icons/file-type-npm';
import IcGit from '~icons/vscode-icons/file-type-git';
import IcConfig from '~icons/vscode-icons/file-type-light-config';

type IconCmp = FC<SVGProps<SVGSVGElement>>;

const EXT_MAP: Record<string, IconCmp> = {
  ts: IcTs, mts: IcTs, cts: IcTs, tsx: IcTsx,
  js: IcJs, mjs: IcJs, cjs: IcJs, jsx: IcJsx,
  json: IcJson, jsonc: IcJson,
  py: IcPy, pyw: IcPy, go: IcGo, php: IcPhp, rb: IcRb, rs: IcRs, java: IcJava, kt: IcKt, kts: IcKt,
  c: IcC, h: IcH, hpp: IcH, hh: IcH, cpp: IcCpp, cc: IcCpp, cxx: IcCpp, cs: IcCs,
  css: IcCss, scss: IcScss, sass: IcScss, less: IcLess, html: IcHtml, htm: IcHtml, vue: IcVue, svelte: IcSvelte,
  yml: IcYaml, yaml: IcYaml, md: IcMd, markdown: IcMd, mdx: IcMd,
  sh: IcSh, bash: IcSh, zsh: IcSh, fish: IcSh,
  sql: IcSql, xml: IcXml, toml: IcToml, ini: IcIni, cfg: IcConfig, conf: IcConfig,
  svg: IcSvg, png: IcImg, jpg: IcImg, jpeg: IcImg, gif: IcImg, webp: IcImg, ico: IcImg, bmp: IcImg,
};

function fileIcon(name: string): IconCmp {
  if (name === 'Dockerfile' || name.endsWith('.dockerfile')) return IcDocker;
  if (name === 'package.json' || name === 'package-lock.json') return IcNpm;
  if (name.endsWith('.d.ts')) return IcTsDef; // tsconfig.json falls through to the JSON icon
  if (name.startsWith('.git')) return IcGit;
  if (name.startsWith('.env')) return IcConfig;
  if (/^readme/i.test(name)) return IcMd;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return EXT_MAP[ext] ?? IcDefault;
}

/** Modern VS-Code-style icon: real coloured file-type glyphs + open/closed folders.
 *  Folder categorisation (coloured per-type icons) lives in ../lib/folderTypeIcons. */
export function FileIcon({ name, dir, open }: { name: string; dir?: boolean; open?: boolean }) {
  if (dir) {
    const f = folderTypeIcons(name);
    const Cmp = open ? f.open : f.closed;
    return <Cmp className="ficon" />;
  }
  const Cmp = fileIcon(name);
  return <Cmp className="ficon" />;
}
