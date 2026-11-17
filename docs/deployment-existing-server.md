# 在已有服务的阿里云服务器上部署

本方案为已有网站网关的服务器增加课堂应用，使用独立 Compose 项目 `function-classroom`。新增应用默认只映射到宿主机 `127.0.0.1:1116`；容器内部继续使用3001端口。这里的命令均单独使用 `compose.existing-proxy.yaml`，不与默认 `compose.yaml` 合并，也不启动项目自带的 Caddy 网关。

本次已选定访问地址 `https://classroom.william-ash.com`，使用现有 Nginx / 宝塔接入。用户已确认主域名 `william-ash.com` 完成ICP备案并接入阿里云，因此子域名无需单独重新备案。这是一份待接入实际服务器的配置，尚未修改 DNS、已有网关或云端服务。“公网直接使用1116”保留为备用说明。

依据[阿里云子域名备案说明](https://help.aliyun.com/zh/document_detail/3043304.html)，主域名备案成功后，其下子域名无需再单独备案，但内容应符合备案主体及相关要求。中国内地部署还应确认已在阿里云接入；仅购买域名不等于完成备案。在其他服务商备案的接入情况，可按[阿里云备案域名说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/support/for-the-record-domain-faq/)核对。

## 推荐接法：应用1116，子域名访问

```text
https://classroom.william-ash.com
          ↓
现有 Nginx / Caddy（443，按域名分流）
          ↓
127.0.0.1:1116 → 课堂容器:3001 → 独立课堂数据卷
```

此配置适用于网关运行在宿主机上的情况。若网关本身运行在独立 Docker 网络中，它的 `127.0.0.1` 指向网关容器；需要先确认现有容器网络，再通过共享网络转发到课堂服务，不可直接照抄回环地址。

### 1. 准备应用

服务器需要 Git、Docker Engine 和 Docker Compose 插件。以下 Docker 操作使用 `sudo`，适用于尚无 Docker socket 访问权限的普通登录用户（如 `admin`）。先验证 Docker 服务访问权限，并确认1116未被其他服务占用：

```bash
docker compose version
sudo docker info
sudo ss -ltnp '( sport = :1116 )'
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/WilliamXuSjtuer/function-classroom.git
cd function-classroom
cp -n deploy/aliyun.env.example .env
chmod 600 .env
nano .env
```

`.env` 的关键配置如下，密钥在服务器上填写：

```dotenv
CLASSROOM_ORIGIN=https://classroom.william-ash.com
CLASSROOM_PORT=1116
DEEPSEEK_API_KEY=填写实际密钥
```

`CLASSROOM_ORIGIN` 必须与浏览器地址的协议、域名、端口完全一致，不带末尾斜杠。应用据此检查请求来源；`COOKIE_SECURE=true` 固定开启，浏览器须通过 HTTPS 登录。不要通过修改 Cookie 配置来绕过 HTTPS。

```bash
sudo docker compose -f compose.existing-proxy.yaml config --quiet
sudo docker compose -f compose.existing-proxy.yaml up -d --build
sudo docker compose -f compose.existing-proxy.yaml ps
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:1116/api/health
```

每一步成功后再执行下一步。健康检查应返回 `{"ok":true}`，之后创建教师账号：

```bash
sudo docker compose -f compose.existing-proxy.yaml exec app node dist-server/server/create-teacher.js
```

教师账号由终端交互创建，生产环境不创建演示账号。

若出现 `permission denied ... /var/run/docker.sock`，说明当前用户无法访问 Docker 守护进程；用上面的 `sudo` 命令继续操作。`config --quiet` 不连接守护进程，其通过不代表有权限启动容器。此时健康检查的 `Connection refused` 是容器尚未启动的结果，无需调整域名或安全组。若 `sudo docker info` 仍报错，先处理其具体错误，再执行构建。Docker权限说明见[官方Linux安装后步骤](https://docs.docker.com/engine/install/linux-postinstall/)。

### 2. 解析子域名、接入现有网关

将 `classroom.william-ash.com` 的 A 记录解析到该服务器公网 IPv4。若配置 AAAA 记录，也应指向实际可达的同一服务。根域名与其他子域名保持原用途。

**Nginx / 宝塔：** 新建 `classroom.william-ash.com` 站点，为此子域名申请或配置有效证书，将整个站点反向代理到 `http://127.0.0.1:1116`，允许10MB请求体。已有根域名证书未必包含子域名，应检查证书覆盖范围。

手工配置可参考 [`deploy/nginx-classroom.conf.example`](../deploy/nginx-classroom.conf.example)。将证书路径替换为服务器实际路径，作为独立站点加入现有配置；不要覆盖 `nginx.conf` 或其他站点。启用后先检查配置再重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

宝塔安装的 Nginx 应使用面板提供的配置检查和重载入口，以实际安装方式为准。

**宿主机 Caddy：** 在现有 Caddyfile 中追加以下站点，按现有服务的管理方式验证并重载。由原 Caddy 统一负责证书：

```caddyfile
classroom.william-ash.com {
    encode zstd gzip
    request_body {
        max_size 10MB
    }
    reverse_proxy 127.0.0.1:1116
}
```

此方式沿用现有公网80/443入口，阿里云安全组无需新增1116规则。Docker端口显式绑定回环地址，应用供宿主机网关访问，相关行为见 [Docker端口发布文档](https://docs.docker.com/engine/network/port-publishing/)。

## 公网直接使用1116

若访问地址必须是 `https://william-ash.com:1116`，让现有网关监听公网1116并终止 TLS。应用改用空闲的本地端口，例如1117，避免网关与应用同时占用1116：

```dotenv
CLASSROOM_ORIGIN=https://william-ash.com:1116
CLASSROOM_PORT=1117
```

Nginx示例中的三处相应改为：

```nginx
listen 1116 ssl;
server_name william-ash.com;
# 在 location / 内：
proxy_pass http://127.0.0.1:1117;
```

证书路径使用覆盖 `william-ash.com` 的有效证书；保留现有证书续期方式。宿主机 Caddy 可在现有配置内使用 `https://william-ash.com:1116` 站点地址，并将上游改为 `127.0.0.1:1117`；其证书验证仍须使用现有可用的标准端口或 DNS 验证流程，不能只映射1116就假定证书签发可用。

只有这种访问方式需要在阿里云安全组及服务器防火墙开放公网 TCP 1116；1117继续仅供本机网关使用。更新 `.env` 后执行同一份 Compose 的 `up -d`。浏览器使用完整 HTTPS 地址，不能直接访问应用的 HTTP 端口。

## 验收、备份与更新

通过最终公网地址检查 `/api/health`，再测试教师登录、学生登录、公式、图片上传、课堂阶段切换及全班进度刷新。模型配置须用真实请求单独验证。上述检查需要目标服务器、DNS 和证书就绪后执行。

数据保存在本项目的 `classroom-data` 卷中，默认实际卷名为 `function-classroom_classroom-data`。后续部署始终使用同一项目名和同一配置文件，避免意外创建空数据卷。

备份并复制到服务器外的位置：

```bash
sudo docker compose -f compose.existing-proxy.yaml exec app node dist-server/server/backup.js
# 将“具体时间目录”替换为上一条命令打印的备份目录名。
sudo docker compose -f compose.existing-proxy.yaml cp app:/app/data/backups/具体时间目录 ./classroom-backup
```

在没有课堂活动时更新：

```bash
git pull --ff-only
sudo docker compose -f compose.existing-proxy.yaml up -d --build
sudo docker compose -f compose.existing-proxy.yaml logs --tail=100 app
```

更新保留原数据卷，不执行 `down -v`。备份恢复、课堂演练要求见[阿里云部署说明](./deployment-aliyun.md)。Nginx配置依据其[反向代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)和[HTTPS文档](https://nginx.org/en/docs/http/configuring_https_servers.html)；Caddy证书行为见[自动HTTPS文档](https://caddyserver.com/docs/automatic-https)。

## 本地配置验证

使用官方 Docker Compose 命令完成配置解析，确认只启动应用、回环端口映射正确、生产模式和安全 Cookie 开启、数据库卷持久化、缺少公网来源配置时拒绝启动。子域名1116及备用公网1116方案的配置均通过；文档和 YAML 格式检查通过。本机没有运行 Docker 守护进程和 Nginx，尚未执行容器构建启动、服务器 `nginx -t` 或公网验证，须在实际服务器上完成上述部署与验收步骤。
