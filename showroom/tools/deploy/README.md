# 腾讯云 EO Pages 部署

这是一个纯静态 Vite / Three.js 展厅。发布目录是 `showroom/dist`，无需后端、数据库或运行时环境变量。域名根路径是部署入口；页面使用 `#reveal` 等锚点导航，无需配置全路径 SPA 重写。

## 生成上传包

在工作区根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\showroom\tools\deploy\package.ps1
```

脚本重新构建，检查文件数和单文件大小，再把产物打包到 `showroom/.artifacts/xiaomi-vision-gt-eo-时间戳.zip`。ZIP 内的 `index.html` 与 `edgeone.json` 位于最外层。旁边的 `.sha256` 用于核验压缩包。

上传包包含三款车型的两档优化模型、全部静态降级图片、本地字体、程序和署名。三款原始 GLB 保存在仓库根目录的 `models/` 中，不属于网站运行资源。

脚本逐文件写入使用 `/` 的 ZIP 相对路径，兼容 Windows PowerShell 5.1。旧版 `.NET CreateFromDirectory` 可能在本地文件头写入 `\`，导致 EO 提示文件名含非法字符；仅重命名 ZIP 或检查解压工具显示的路径无法排除这个问题，应使用当前脚本重新打包。

## 控制台上传

Vision GT 的原始流场为 30 MiB，超过平台单文件限制。生产构建将 `dist/flow/vision-gt.bin` 替换为相同数据的 gzip 文件（约 16 MiB），并由 `edgeone.json` 为这个精确路径设置 `Content-Encoding: gzip`。浏览器访问原始 URL 时自动解压，支持 `DecompressionStream` 的浏览器仍使用独立的 `.bin.gz` URL。`public/flow` 中的原始数据保留供离线核验；部署时必须保留产物中的响应头配置。

1. 登录腾讯云 EO，进入 Pages（部分新版文档称为 EdgeOne Makers），创建项目并选择“直接上传”。
2. 设置项目名，例如 `xiaomi-vision-gt`，根据域名和受众选择加速区域。
3. 上传上述 ZIP，开始部署。直接上传使用已构建产物，不填写安装或构建命令。
4. 部署成功后，使用控制台提供的完整预览链接访问；如链接带验证参数，应保留这些参数。
5. 在“域名管理”添加自定义域名，按控制台给出的实际 DNS 记录配置解析，并检查 HTTPS 证书状态。

包含中国大陆的加速区域要求自定义域名已备案；未备案域名可以选择“全球可用区（不含中国大陆）”。默认预览域名可能有访问区域或有效期限制，正式展示应绑定自定义域名。

选择直接上传后，不能在同一项目内切换到 Git 集成。将来需要推送代码自动部署时，应新建 Git 集成项目。源码仓库若以 `showroom` 为根，构建命令为 `npm run build`，产物目录为 `dist`；若仓库包含外层 workspace，产物目录为 `showroom/dist`。构建 Node 版本须符合 Vite 7 要求（20.19+ 或 22.12+），避免直接照抄旧平台文档中的 22.11 示例。

## 发布后验证

- 从 HTTPS 首页进入 3D，并检查 `#aero`、`#wheel`、`#tail` 的直接访问。
- 检查三款车型的模型请求（按设备选择标准或轻量档）均返回 GLB 二进制，不能是 HTML 错误页。
- 检查配色、车门、速度、驾驶席灯带与屏幕，以及手机端加载。
- 禁用 WebGL 时应显示相应静态图片；资源地址不能指向 localhost。
- 用开发者工具核对实际响应头：哈希命名的 `/assets/*` 长缓存，首页、固定文件名模型和图片重新验证。平台规则优先级与 CDN 行为须在线上核验。
- 更新时上传新的完整 ZIP；若额外设置过强制边缘缓存，应按控制台提供的方式刷新对应缓存。保留旧 ZIP 可重新上传回退。

已随 `public/edgeone.json` 配置响应头，Vite 会把它复制到产物根目录。后续修改模型或静态图片时仍应同步更新代码中的资源版本号。

官方资料（部署前核对当前控制台）：

- [直接上传](https://pages.edgeone.ai/document/direct-upload)
- [edgeone.json 配置](https://pages.edgeone.ai/document/edgeone-json)
- [腾讯云自定义域名](https://cloud.tencent.com/document/product/1552/127404)
- [加速区域与预览域名](https://edgeone.cloud.tencent.com/pages/document/175191784523485184)
