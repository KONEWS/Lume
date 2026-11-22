# 澄音内置的 Folia 歌词样式

18 种歌词画面取自本地 folia-Lyrics 提交 `683263bd0d062816a4e2b51c00d203ca52766f8a`。原项目为 [Folia](https://github.com/chthollyphile/folia-major)，桌面分支为 [folia-Lyrics](https://github.com/KONEWS/folia-Lyrics)。授权见 LICENSE。

此分支用澄音的曲目信息、本地歌词和播放时钟驱动原渲染器。歌词样式设置、预览图、字体与本地素材管理一起打包，设置通过设备本地存储保存。雾笺使用字体骨架追踪。逐行 LRC 的字词动画在行内分配时间。无时间戳的歌词保留全文阅读。

桌面和手机构建使用随源码提交的静态资源。修改渲染器时在本目录安装锁定的构建依赖后运行 `npm run build`，会同步生成桌面和两种手机端使用的资源。
