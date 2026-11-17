# 阿里云部署说明

本项目提供适用于阿里云 Linux 服务器的 Docker 单实例部署方案。具体服务器规格、地域和域名由部署时选定；本次开发没有创建云资源。

**服务器已有其他服务时：** 使用[已有服务器部署说明](./deployment-existing-server.md)及 `compose.existing-proxy.yaml`。该方案默认把应用映射到 `127.0.0.1:1116`，通过现有网关接入 `william-ash.com` 下的地址。下文的默认 `compose.yaml` 会启动独立网关并占用80/443，只适用于这些端口可供本项目独占的情况。

## 运行结构

```text
学生平板 / 教师浏览器
          │ HTTPS
          ▼
      Caddy 网关
          │ 内部网络
          ▼
   Node.js 课堂服务 ─── DeepSeek API
          │
          ▼
   持久化数据卷：SQLite + 手写图片
```

Node.js 服务在内部3001端口提供 API 与构建后的前端。只有网关的80、443端口映射到公网。域名、HTTPS 和源检查采用同一配置，课堂记录通过登录及角色权限访问。

## 部署步骤

1. 准备安装了 Docker Engine 和 Docker Compose 插件的 Linux 服务器，将代码放入部署目录。
2. 将准备使用的域名解析到服务器；为 HTTPS 网关配置必要的网络入口。
3. 复制 `.env.example` 为 `.env`，至少填写实际 `DOMAIN` 和 `DEEPSEEK_API_KEY`。模型默认使用 `deepseek-flash`。不要把 `.env` 加入版本控制或发送给学生。
4. 构建并启动：

```bash
docker compose up -d --build
docker compose ps
```

5. 创建教师账号：

```bash
docker compose exec app node dist-server/server/create-teacher.js
```

6. 打开 `https://你的域名`，使用教师账号创建班级、导入名册、核对并发布课时，再组织学生试用。

Compose 固定 `NODE_ENV=production`、`DEMO_MODE=false`、`COOKIE_SECURE=true`，并从 `DOMAIN` 生成请求来源配置。演示账号不会自动创建。

服务端使用的模型密钥不参与前端构建。修改 `.env` 后运行 `docker compose up -d` 使容器配置生效。

## 持久化与备份

`classroom-data` 卷保存数据库和图片，`caddy-data` 卷保存网关证书资料。更新应用时保留这些卷；不要使用 `docker compose down -v`，该命令会删除持久化卷。

备份命令：

```bash
docker compose exec app node dist-server/server/backup.js
```

脚本先通过 SQLite `VACUUM INTO` 创建一致的数据库快照，再复制不可变的上传文件，输出备份目录。把该目录复制到服务器之外的备份位置，例如在后续部署工作中配置阿里云对象存储。

```bash
docker compose cp app:/app/data/backups/具体时间目录 ./classroom-backup
```

恢复时先停止应用，保存当前数据备份，再把目标备份中的数据库和 `uploads` 目录一起恢复到数据卷；停止旧服务后再移除其遗留的 `classroom.sqlite-wal`、`classroom.sqlite-shm`，避免与快照混用。恢复后检查教师登录、历史消息及图片访问，再开放课堂。

## 上课前检查

- 教师账号、班级名单与学生学号正确，前导零保留。
- 课时已审核发布；例题正误版本及评价标准与实际备课一致。
- 使用真实 DeepSeek 接口验证中文解释、数学公式、手写图片和评价证据。
- 使用目标平板验证触控、横竖屏布局、图片上传和长对话。
- 在目标服务器组织接近50人的并发演练，观察消息保存、模型排队、阶段切换及失败重试。
- 导出一份 Excel 与图片包，检查记录关联；前后测成绩继续单独管理。

本地模拟负载只能验证应用层行为。实际课堂体验还取决于服务器资源、校园网络、DeepSeek 配额及响应时间，需以上述演练结果决定配置。

## 更新和日志

```bash
docker compose up -d --build
docker compose logs --tail=100 app
```

在没有课堂活动的时段更新应用。应用重新启动时，未完成的模型请求会保留原消息并标记可重试，不伪造反馈或自动判为通过。
