# Redline

在 VS Code / Cursor 里对照两个本地 Git 分支，打开完整文件并标出改动。

## 能做什么

- 选择基准分支和比较分支，列出这次改动的文件。
- 在编辑器里用浮层标出新增和修改的行，也可以切换成左右双栏比对。
- 在改动文件里右键查看某一行所在函数的影响面。
- 本地分支落后远端时，可以确认后把远端代码快进合并到本地。

## 开发

```bash
npm install
npm test
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

生成的 `.vsix` 可以用「从 VSIX 安装」装进编辑器。

## 许可

[MIT](LICENSE)
