# 3D汽车网站

基于 Three.js、React、TypeScript 和 Vite 的交互式汽车展示网站，支持多车型切换、360° 看车、配色、行驶与风洞演示，可继续扩展其他车型。

## 本地运行

使用 Node.js 22.12+ 或 24 LTS，在项目根目录执行：

```sh
npm ci
npm run dev
```

打开 [本地网站](http://127.0.0.1:5173/)。生产构建与预览：

```sh
npm run build
npm run preview
```

构建产物位于 `showroom/dist`。参见[部署与打包说明](showroom/tools/deploy/README.md)。

## 功能与扩展

- 多车型切换、自由环绕、缩放、预设机位和概念配色。
- 行驶与风洞可视化；车门和驾驶席功能按车型适配。
- 性能不足或加载失败时使用静态图片，并支持重试 3D。
- 新增车型在 `showroom/src/vehicles.ts` 配置，原始模型放在 `models/`。

风洞用于视觉展示，Cd 为估算或尚未标定。技术细节见[模型制备](showroom/tools/model/README.md)与 [CFD 方法](showroom/tools/model/cfd/README.md)。

## 检查

`npm run build` 包含 TypeScript 检查。浏览器检查需先启动开发服务，再进入 `showroom/tools/stills/` 执行：

```sh
npm ci
node verify-wind-camera.mjs
npm run verify:ui -- http://127.0.0.1:5173
```

## 模型与许可

| 模型 | 作者与原作 | 许可 |
| --- | --- | --- |
| Xiaomi Vision GT | [hartwelkisaka](https://sketchfab.com/3d-models/xiaomi-vision-gt-a464599492e94e508b999b4775141727) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| SU7 Ultra | [Ddiaz Design](https://sketchfab.com/3d-models/2025-xiaomi-su7-ultra-production-version-9d0a0a9285cb4ca59ccb9322ddf58d24) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| McLaren Ultimate Vision GT | [VTX](https://sketchfab.com/3d-models/mclaren-ultimate-vision-gt-ffaaeb3b72ac4f12a35a4753bd9cc51b) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

网页模型经过压缩、减面或部件拆分，保留原始署名。界面采用 [BoardUI（MIT）](showroom/public/licenses/BoardUI-MIT.txt)，字体使用 [Inter](showroom/public/fonts/OFL-Inter.txt) 与 [Barlow Condensed](showroom/public/fonts/OFL-Barlow-Condensed.txt)（SIL OFL）。
