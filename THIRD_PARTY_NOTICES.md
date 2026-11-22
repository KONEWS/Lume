# 歌词与第三方来源

## 歌词、动效与预览素材

播放时显示的歌词正文、翻译和时间轴来自用户导入的音频标签或配套歌词文件（如同名 LRC）。加入播放空间后，也可使用分享设备提供的歌词。歌曲、歌词和翻译的署名归各自作者及权利人。项目随附的演示和测试文字用于预览或验证播放器。

动态歌词画面、样式预览、着色器及桌面歌词设置源于 chthollyphile 的 Folia。澄音经 KONEWS 的 folia-Lyrics 分支适配，接入本机曲目、播放时钟、窗口控制和设置。移动端及共用渲染器的引入记录为 `683263bd0d062816a4e2b51c00d203ca52766f8a`，独立桌面歌词页基于 Folia Desktop Lyrics 0.5.7。两个目录保留可编辑源码和 GNU AGPL v3 许可全文。[Folia 原项目](https://github.com/chthollyphile/folia-major) · [桌面分支](https://github.com/KONEWS/folia-Lyrics) · [共用渲染器说明](folia/README.md) · [桌面适配记录](pc-lyrics/ATTRIBUTION.md) · [许可证](folia/LICENSE)

### 样式预览中使用的两首歌

Folia 的样式编辑器随附下列两首歌的歌词、译文和时间轴，用于预览歌词排版和动效。预览数据由 Folia 引入，其文件未注明译者或时间轴制作者。歌曲及歌词版权归各自权利人，Folia 的软件许可仅说明代码的使用条件。[预览数据目录](folia/src/components/visualizer/previewSongs/)

| 歌曲 | 演唱 | 作词 | 作曲、编曲 | 署名出处 |
| --- | --- | --- | --- | --- |
| 踊 | Ado | DECO\*27 | Giga、TeddyLoid | [环球音乐日本](https://www.universal-music.co.jp/ado/news/2021-04-22/) |
| 星降る海 | 月見ヤチヨ（CV 早見沙織） | Aqu3ra | Aqu3ra | [《超かぐや姫！》官网](https://www.news.cho-kaguyahime.com/593/) |

### 歌词组件

| 组件或素材 | 来源、用途与授权 |
| --- | --- |
| TTML | 桌面歌词工程使用 AMLL 的 `@applemusic-like-lyrics/ttml`，AGPL-3.0-only。[Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics) |
| 雾笺笔顺 | Folia 从 FM&SH 的 AnimCJK 提取笔画中线，涉及文鼎字形及 Make Me a Hanzi 数据。使用的 graphics 数据按 Arphic Public License 分发。构建脚本记录上游提交、转换方法和授权文件。[AnimCJK](https://github.com/parsimonhi/animCJK) · [构建记录](pc-lyrics/dev/nebbia/nebbiaStrokesPlugin.mjs) |
| 中文分词与繁简映射 | jieba 的词典和 HMM 数据来自 Sun Junyi，MIT。繁简映射使用 opencc-js 及 OpenCC 数据，许可见上游。[jieba 来源和校验值](pc-lyrics/dev/icuFolia/jieba/README.md) · [opencc-js](https://github.com/nk2028/opencc-js) |
| 歌词字体 | HarmonyOS Sans SC 来自华为，版权 © 2021 Huawei Device Co., Ltd.，按随附字体协议使用原始文件。Noto Sans CJK SC 和 Noto Serif SC 按 SIL Open Font License 1.1 使用。[华为字体来源及校验值](pc-lyrics/public/fonts/README.md) · [华为字体协议](pc-lyrics/public/fonts/HarmonyOS-Sans-LICENSE.txt) · [Noto CJK](https://github.com/notofonts/noto-cjk) · [Noto 字体许可](pc-lyrics/public/fonts/Noto-OFL.txt) |
| 歌词场景绘制 | Folia 歌词工程使用 Three.js、PixiJS、React Three Fiber、Paper Design Shaders 等。预览图和占位封面随 Folia 适配代码引入。具体依赖版本见 [Folia 锁定清单](folia/package-lock.json)和[桌面歌词锁定清单](pc-lyrics/package-lock.json)。 |

## 界面、音频及随附资源

| 组件或素材 | 来源、用途与授权 |
| --- | --- |
| Lens 透镜设计系统 | DayDreamInAReverie，MIT。澄音通过 KONEWS/design-systems 的 `7a424c9` 引入 WebGL2 折射及弹性手势。[使用的分支](https://github.com/KONEWS/design-systems) · [许可证](src/appearance/lens/LICENSE) |
| Lucide 图标 | Lucide Contributors，ISC。继承自 Feather 的部分由 Cole Bemis 创作，MIT。[Lucide](https://github.com/lucide-icons/lucide) · [随附声明](mobile/player-assets/player/vendor/lucide/LICENSE) |
| 音频元数据与原生音频 | music-metadata 用于读取标签、歌词与封面，MIT。移动原生代码使用 David Reid 的 miniaudio 0.11.23，其头文件提供公有领域或 MIT-0 两种选项。[music-metadata](https://github.com/Borewit/music-metadata) · [miniaudio 源文件与许可](mobile/native/vendor/miniaudio.h) |
| 原生 HTTP 与 JSON | cpp-httplib 来自 Yuji Hirose，JSON for Modern C++ 来自 Niels Lohmann 等贡献者，均为 MIT。[cpp-httplib 许可](mobile/native/vendor/LICENSE-httplib) · [JSON 许可](mobile/native/vendor/LICENSE-json) |
| 节拍、音轨分析模型 | Beat This! 来自 CPJKU，HTDemucs 来自 Meta Research。Folia 提供转换后的权重和 SHA-256，清单列出两个模型各自的来源及 MIT 许可。首次构建按清单下载。[Beat This!](https://github.com/CPJKU/beat_this) · [Demucs](https://github.com/facebookresearch/demucs) · [模型、转换及镜像清单](pc-lyrics/shared/modelManifest.json) |
| FFmpeg 构建资料 | Folia 桌面工程随附 FFmpeg 8.1.2 的构建参数、源码地址、校验值及 LGPL 许可。[构建记录和许可](pc-lyrics/build/ffmpeg/win-x64/share/folia-ffmpeg/) |
| 试听音乐 | 《潮汐之间》《月色落在水面》《林间的呼吸》署名 LUME Studio，由仓库内的振荡器合成脚本生成。校准音随试听资源提供。[生成脚本](scripts/generate-demo.mjs) · [曲目清单](resources/demo/manifest.json) |

桌面外壳使用 Electron，网页界面使用 React、Vite，局域网服务使用 Express 和 ws。仓库的三份 npm 锁定清单记录直接及间接依赖和相应版本。[主工程依赖](package-lock.json) · [共用歌词依赖](folia/package-lock.json) · [桌面歌词依赖](pc-lyrics/package-lock.json)
