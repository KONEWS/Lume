# 移动端开发约定

每次修改澄音移动端功能、界面或动效，都要同步适配 Android 和 HarmonyOS。共用播放器界面在 `mobile/player-assets/player` 中维护。涉及原生能力时，同时检查两端对应的实现。

交付前构建 Android APK 和 HarmonyOS HAP，核对两份安装包都包含本次改动。分别说明两端实际完成的验证，包括真机验证情况。
