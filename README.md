# 片刻 ClipNest

导入视频，选出想要的片段，一次生成 **无声 MP4 + 独立 MP3 / WAV**。支持预览选区、导出进度、取消处理，以及 ZIP 打包下载。

**[打开在线版](https://rikka-zzz.github.io/clipnest/)** · **[下载完整源码 ZIP](https://github.com/RIKKA-ZZZ/clipnest/archive/refs/heads/main.zip)**

## 在线版与本地版有什么区别？

| | GitHub Pages 在线版 | 本地部署版 |
| --- | --- | --- |
| 需要安装软件吗 | 不需要，直接用浏览器打开 | Node.js；10GB 模式还需要 FFmpeg |
| 处理引擎 | 浏览器内 ffmpeg.wasm | 优先使用电脑上的 FFmpeg |
| 视频输入上限 | **1 GiB**（界面显示 1 GB） | **10 GiB**（界面显示 10 GB） |
| 文件选择 | 浏览器文件选择、拖拽 | Windows 系统文件窗口、拖拽 |
| 大文件处理 | 受浏览器内存影响较大 | 从磁盘读取、写出结果 |
| 视频上传云端吗 | 不上传 | 不上传；拖拽素材会传送至本机处理进程 |

静态托管不能启动 Windows 文件窗口，也不能执行服务器上的 FFmpeg。**想使用 10GB 模式，请按下面教程在电脑上运行。** GitHub Pages 只发布 `dist/` 静态文件。[GitHub Pages 说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 本地部署教程（Windows）

### 1. 下载必要软件

| 软件 | 是否必需 | 下载链接 | 安装要点 |
| --- | --- | --- | --- |
| **Node.js LTS** | 本地启动必需 | [Node.js 官方下载](https://nodejs.org/en/download) | 选择 Windows 安装包和 LTS，保留添加到 PATH 的选项 |
| **FFmpeg（包含 ffprobe）** | 本机 10GB 模式必需 | [FFmpeg 官方下载索引](https://ffmpeg.org/download.html) · [Gyan Windows 构建下载](https://www.gyan.dev/ffmpeg/builds/) | 下载 Windows 已编译版本，确保有 `ffmpeg.exe` 和 `ffprobe.exe` |
| **Git** | 可选；下载 ZIP 可不安装 | [Git for Windows 官方下载](https://git-scm.com/install/windows) | 方便克隆源码及后续 `git pull` 更新 |

FFmpeg 官网提供的是源代码，Windows 可执行文件由官网列出的构建提供方提供。在 Gyan 下载页的 release builds 中选择 essentials ZIP 即可满足本项目常见音视频处理需求；不用下载源代码包，也不必选择完整开发包。[FFmpeg 官方下载说明](https://ffmpeg.org/download.html)

如果电脑有 winget，也可以只用下面的命令安装 FFmpeg：

```powershell
winget install --id Gyan.FFmpeg -e --source winget
```

安装完软件后，**关闭旧终端，再打开新的 PowerShell**，让新 PATH 生效。

本项目已包含网页运行依赖，**不需要 `npm install`，不需要 Python、Docker、数据库或额外的视频模型**。Python 和 Pillow 只用于开发者重新生成演示素材。

### 2. 将 FFmpeg 加入 PATH（手动解压安装时）

如果用 winget 安装并且后面的版本检查正常，可以跳过本步。

1. 解压 FFmpeg，例如放到 `C:\tools\ffmpeg`。
2. 找到真正包含 `ffmpeg.exe` 和 `ffprobe.exe` 的 `bin` 文件夹。若解压后多了一层版本目录，要进入那一层查找。
3. 在 Windows 搜索“编辑账户的环境变量”，编辑用户变量 `Path`，新增这个 **bin 文件夹路径**，例如 `C:\tools\ffmpeg\bin`。
4. 确定保存，关闭并重新打开 PowerShell。

不要把 ZIP 文件路径或单个 `ffmpeg.exe` 文件路径添加到 Path。需要的是两个 EXE 所在的目录。

### 3. 检查安装

在新打开的 PowerShell 中逐行执行：

```powershell
node --version
npm.cmd --version
ffmpeg -version
ffprobe -version
```

四条命令都应输出版本信息。若只有 Node.js 正常，也能运行浏览器模式；要启用本机 10GB 模式，FFmpeg 与 ffprobe 都必须能被找到。

### 4. 下载项目

**方法 A：下载 ZIP，无需 Git。**

打开本仓库的 **Code → Download ZIP**，或点击 [源码 ZIP 下载](https://github.com/RIKKA-ZZZ/clipnest/archive/refs/heads/main.zip)。解压后进入 `clipnest-main` 文件夹，确认里面能看到 `package.json`、`dist` 和 `scripts`。

**方法 B：使用 Git。**

```powershell
git clone https://github.com/RIKKA-ZZZ/clipnest.git
cd clipnest
```

### 5. 启动

在含 `package.json` 的项目文件夹中打开 PowerShell，执行：

```powershell
npm.cmd run dev
```

也可以直接运行：

```powershell
node scripts/serve.mjs
```

终端出现以下地址后，用 Chrome 或 Edge 打开它：

```text
http://127.0.0.1:4178
```

界面右上角应显示 **“本机引擎已就绪”**，导入提示应显示 **“本机模式最大 10 GB”**。若显示浏览器模式，请检查 FFmpeg 的 PATH，并重新启动本地服务。

**保留启动服务的终端窗口。** 关闭终端或按 `Ctrl + C` 会停止服务。电脑重启后，重新进入项目目录运行启动命令即可，不需要再次安装。

不能直接双击 `dist/index.html`：模块 Worker 和处理引擎需要通过 HTTP / HTTPS 加载。

### 6. 使用

1. 点击 **选择视频**，打开系统文件窗口；也可以把视频拖进页面，或先试 8 秒演示素材。
2. 拖动时间线两端，或输入开始、结束时间。支持 `12.5`、`01:12.50`、`00:01:12.50`。
3. 点击 **预览选中片段**，确认起止范围。
4. 选择无声视频、独立音频和 MP3 / WAV 格式，点击 **分离并导出**。
5. 按钮下方会显示阶段、百分比和已用时，可随时取消。
6. 完成后分别下载，或打包下载 ZIP。

系统窗口选中的视频会从原文件直接读取；拖入浏览器的 File 会在本机缓存一份。两种方式均没有云端媒体上传。

## GitHub Pages 静态部署教程

本仓库包含 `.github/workflows/pages.yml`，无需网站构建命令或付费服务器。

1. 将项目推送到 GitHub 仓库的 `main` 分支，或 Fork 此仓库。
2. 进入仓库 **Settings → Pages → Build and deployment**。
3. 将 **Source** 设置为 **GitHub Actions**。
4. 进入 **Actions → Deploy static site to GitHub Pages → Run workflow**，或推送一次新的提交。
5. 工作流会检查资源和引擎 SHA-256，上传 `dist/`，然后部署。
6. 部署成功后，在 Pages 设置或工作流页面打开分配的 HTTPS 地址。

当前项目地址为 `https://rikka-zzz.github.io/clipnest/`。Fork 后，地址由你的 GitHub 用户名和仓库名决定。项目使用相对静态资源路径，可运行在 `/仓库名/` 子目录下。

工作流使用 `contents: read`、`pages: write` 和 `id-token: write` 权限，不需要另外创建访问令牌。静态输出不包含本机处理服务、素材缓存或私有配置。[官方自定义工作流教程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

如果要使用自己的域名：先在 **Settings → Pages → Custom domain** 中配置，再按 GitHub 提示设置 DNS，等待 HTTPS 证书就绪。没有自有域名时，直接使用免费的 `github.io` 地址即可。[自定义域名说明](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## 常见问题

**文件选择窗口没有出现？**

本地版请确认显示“本机引擎已就绪”。系统窗口有时在其他窗口后方，可以检查任务栏。在线版使用浏览器文件选择；内嵌浏览器可能不完整支持文件弹窗，建议在独立 Chrome / Edge 中打开，也可直接拖入视频。

**提示找不到 FFmpeg 或一直是 1GB 模式？**

```powershell
where.exe ffmpeg
where.exe ffprobe
```

检查两个程序都能被找到。修复 PATH 后，关闭并重新打开终端，再启动服务。在线 GitHub Pages 固定是浏览器模式，无法通过安装本机 FFmpeg 自动获得远程 10GB 模式。

**PowerShell 提示 npm.ps1 禁止执行？**

使用本教程的 `npm.cmd run dev`，或直接 `node scripts/serve.mjs`，无需修改系统执行策略。

**端口 4178 已被占用？**

先检查是否已经启动过本站；如果已启动，直接访问现有地址。需要另一个端口时，在 PowerShell 中执行：

```powershell
$env:CLIPNEST_PORT = '4188'
node scripts/serve.mjs
```

然后访问 `http://127.0.0.1:4188`。

**首次在线导出需要等一会儿？**

浏览器模式首次需要下载约 31 MiB 的处理引擎。视频不上传，处理在当前设备进行。4K、长片段和大输出仍可能很慢或耗尽浏览器内存；处理时保持页面打开。

**10GB 是否保证任何文件都能处理？**

10 GiB 是本地版设置的输入上限，实际受磁盘空间、设备性能及视频编码影响，未完成完整 10 GiB / 4K 压力测试。大文件路径测试使用 350 MiB 的有效 MP4 容器（含 free-box 填充），验证体积判断、磁盘读取和流式传送，不等同于高码率画面的压力测试。

**ZIP 按钮为什么没有显示？**

本机输出合计超过 2 GiB 时跳过 ZIP，避免当前打包实现的体积限制，请分别下载文件。

**缓存在哪里，能否清理？**

本地临时素材副本与结果位于项目 `.clipnest-cache/`。先下载需要的结果，停止服务后可以删除此目录清理磁盘，不影响原始素材。服务重启后旧下载链接失效。此目录已被 Git 忽略，不会上传到仓库或 Pages。

**如何更新本地版？**

停止服务后，在 Git 克隆的项目目录运行 `git pull`，再重新启动。ZIP 用户重新下载源码，解压到一个新文件夹，再启动即可。

## 处理方式和已知限制

- 精确按时间范围重新编码裁切，不依赖关键帧直接复制。原画面采用 H.264，MP3 / WAV 保留原视频中的混合音轨。
- 不做人声 / 伴奏 AI 分轨，默认使用第一条视频和第一条音轨。没有音轨时提示或跳过音频。
- 默认保留分辨率；奇数宽高会补最多一个像素。重新编码有损，容器和编码帧长可能造成少量时长差。
- 暂未特别处理 HDR 色彩、额外音轨、字幕、章节。文件扩展名不能保证编码受支持。
- 浏览器模式只读挂载文件以减少复制，但输出和 ZIP 仍占用浏览器内存；1GB 是输入上限，不是内存保证。
- 无媒体分析脚本、第三方字体、云端素材存储或账户系统。

## 验证与开发

```powershell
npm.cmd run check
```

静态检查验证应用语法、引擎分块 SHA-256、资源存在性和静态输出边界。测试记录见 `VERIFIED.json`、`NATIVE-VERIFIED.json`；修复说明见 [开发记录](docs/DEVELOPMENT.md)。

已验证：MP4 / WebM、MP3 / WAV、无声音轨处理、ZIP CRC 与中文文件名、Range 请求、取消与重试、实际中间进度，以及手机布局。原生下载保存对话框的完整手动保存流程未做端到端自动化验证。

```text
dist/                    GitHub Pages 发布内容
scripts/serve.mjs        本机 HTTP 服务
scripts/local-engine.mjs 本机 FFmpeg、流式导入导出
scripts/select-video.ps1 Windows 文件选择窗口
scripts/check-static.mjs 静态资源校验
.github/workflows/       Pages 自动部署
.clipnest-cache/         本地临时数据，不进入 Git
```

## 第三方组件与来源

开发前参考 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 和 [WebAV](https://github.com/WebAV-Tech/WebAV)。实际浏览器依赖：`@ffmpeg/ffmpeg@0.12.15`、`@ffmpeg/core@0.12.10`、`fflate@0.8.2`。

第三方许可保存在 `dist/vendor/`，来源和构建链接见 [third-party.txt](dist/third-party.txt)。FFmpeg core 保留 GPL-2.0-or-later 条款，包装层和 fflate 保留 MIT 条款；本机 FFmpeg 使用用户已安装的程序，未随仓库分发桌面可执行文件。

重新获取浏览器依赖可运行 `python scripts/vendor.py`、`python scripts/vendor-licenses.py`。下载脚本限制体积并校验散列。重新生成原创演示素材可运行 `python scripts/make-demo.py`，需要 Pillow 和本机 FFmpeg；这些仅供开发使用。
