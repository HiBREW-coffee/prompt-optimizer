# @DONGWU 创作工作室：免费团队版

代码托管在 GitHub，前端使用 Cloudflare Pages Free，后台复用 Supabase Free。应用不设置试用到期日，不自动升级付费。模型调用仍消耗公司 LK888 额度。免费服务有平台用量限制；Supabase 低活跃项目可能暂停，恢复项目后即可继续使用。

## 功能

独立构建只包含文字优化、最多五张参考图的专业提炼与受控改写，默认进入参考图提炼。品牌、头像和站点图标统一为 @DONGWU。支持灵感卡、复刻、风格学习及七种原项目优化模板。

“提示词”合并原补充说明与修改要求，“需要保留”独立。图1～图5按顺序编号，可设置产品、场景、人物、风格或细节用途；模型接收每张图的编号、图像和用途。引用不存在的图号会在付费请求前阻止。单张 PNG/JPEG 最大 10MB，处理后全部图像合计最大 20MB。

可在生成前分析原文与全部参考图的结构、歧义、固定要素和修改建议，再应用建议优化。生成后仍有独立的成果评分与建议。成果包含完整中文、英文、JSON、图间职责、固定/可变要素、专业结构拆解、负向提示词、参数建议及验收清单。不完整专业报告不保存为成功版本。

新分析必须声明评分量表，统一保存为百分制整数。仅在上游明确声明十分制时换算；不根据数值小于 10 就猜测、放大分数。未声明量表或分值违规的新增结果不保存，不自动重试。旧分析保留原始数字并显示“量表待确认”，可主动重新分析；旧建议与历史记录不被删除。

手动编辑、恢复和建议修改都追加版本，不覆盖旧记录。旧单图作品与旧报告仍可读取；历史成果可主动再生成完整专业报告。包含私人云端历史、收藏、导出、主动发布/撤回的团队精品库。不包含图像生成、MCP 或用户模型密钥设置。默认分享仅含中英及 JSON 提示词；专业报告、原文分析和私人要求不一并发布。旧云端参考图仍需明确勾选才分享；新的临时参考图不支持分享原图。

新参考图只保留在当前页面内存，分析时随请求发送到函数及模型，不写入工作室 Storage。云端只保存图号、用途、说明及文件哈希等文字元数据。刷新或关闭后，重新看图分析必须选择原文件；文件哈希阻止误选其他图片，全部图像仍按顺序送入模型。缺图时不会降级为猜测图片的文字分析，也不会发起模型请求。此约定针对工作室应用存储，不代表第三方模型提供商的数据保留承诺。

成员界面不显示额度或次数。默认取消人为每日次数上限；管理员保留本站请求统计与可选每日上限（0 为不限）。请求统计包含已接收的失败请求，与 LK888 余额、算力及实际计费账单无关。调用仍消耗公司的供应商额度，并受供应商限速和平台资源限制。

“创作经验”仅保存用户明确确认的私人文字规则，可启用、关闭、编辑和移除。最多12条、每条280字，总量16KB以内；每次最多选择4条匹配当前任务/模板的规则。本次明确要求和参考图证据优先。保存经验不调用模型，不自动学习失败结果、图片或整段历史，不训练模型。

## 1. 部署前检查现有 Supabase 项目

确认项目地区和剩余配额；已有应用与本应用共享 500MB 数据库、1GB 存储和免费函数额度。建议用 SQL Editor 新建查询，只运行以下只读检查，不查询任何密钥表或业务数据：

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select table_name from information_schema.tables where table_schema='public' and table_name like 'ps\_%' escape '\';
select id,public,file_size_limit,allowed_mime_types from storage.buckets;
select policyname,roles,cmd,permissive,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
```

若已有 `ps_*` 表或 `prompt-studio-references` 存储桶，先核对来源，不覆盖。迁移创建隔离的表、函数和私有桶。存储的 restrictive guard 防止已有 permissive 规则放开本桶，其他桶保持原有规则。不改变全项目注册、邮件或现有函数配置。

在 SQL Editor 运行 `supabase/migrations/202610230001_prompt_studio.sql` 一次。迁移使用事务，失败会回滚；不要反复执行或自动删除冲突对象。

只按顺序运行尚未应用的迁移：001首版、002五图与专业报告、003取消默认每日上限、004精简私人文字记忆、005临时参考图元数据约束。已完成001/002的项目只执行003、004、005各一次；新项目依次运行五份。不得重跑已完成的迁移。先完成迁移、后台函数更新，再发布新前端。新增迁移不删除任何旧图片或业务记录。

## 2. 发布 Supabase 函数

部署名称必须为 `prompt-studio-api`，不要替换现有 `smart-handler`。

```bash
pnpm install --frozen-lockfile --ignore-scripts
node scripts/sync-team-templates.mjs --check
node scripts/build-team-edge.mjs
```

可以在 Dashboard 创建新 Edge Function，把生成的 `supabase/.temp/prompt-studio-api.ts` 作为单文件源码部署。或者使用已登录的官方 CLI：

```bash
supabase functions deploy prompt-studio-api --project-ref YOUR_PROJECT_REF
```

配置文件对此新函数设置 `verify_jwt=false`，以兼容非对称 JWT；函数自身强制调用 Auth.getUser 验证会话，再验证 `ps_members`。不能去掉其中任一验证。Dashboard 部署时也须关闭此函数的旧式网关 JWT 校验；其他函数保持原配置。

由项目所有者直接在 Supabase Secrets 添加以下设置，**不要把模型 Key 发到聊天、GitHub 或前端**：

| 设置                 | 用途                                            |
| -------------------- | ----------------------------------------------- |
| `PS_LK888_API_KEY`   | 公司 LK888 Key，只在函数内使用                  |
| `PS_LK888_MODEL`     | 默认 `gem-3.8-flash`，需账户支持图片理解        |
| `PS_APP_URL`         | 最终 Cloudflare Pages HTTPS 根地址              |
| `PS_ALLOWED_ORIGINS` | 允许的网站 origin，以英文逗号分隔；不使用通配符 |

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由运行平台提供，绝不复制到前端。服务器固定访问 `https://api.lk888.ai`。只在流式路由 HTTP 404/405/501 且未读取任何响应块时，保留相同输入回退一次 `generateContent`；其他失败不重试。同一次操作合计 120 秒，包括身份验证、下载图、流式及非流式回退。中断不自动重放，可按请求 ID 查询完成结果。

## 3. 连接 GitHub 和 Cloudflare Pages

在 Cloudflare 的 Workers & Pages 中选择 **Pages → Connect to Git**，连接 `HiBREW-coffee/prompt-optimizer`，选择分支 `feature/prompt-studio-design-templates-v1`。首版验证完成后再让团队正式使用。

| 配置                          | 值                                                                     |
| ----------------------------- | ---------------------------------------------------------------------- |
| Framework                     | Vue / None（使用下列显式配置）                                         |
| Root directory                | 仓库根目录                                                             |
| Build command                 | `pnpm build:team`                                                      |
| Build output directory        | `packages/web/dist-team`                                               |
| `NODE_VERSION`                | `24.22.1`（必须填写完整版本）                                          |
| `PNPM_VERSION`                | `10.6.1`                                                               |
| `VITE_TEAM_SUPABASE_URL`      | Supabase 项目公开 HTTPS URL                                            |
| `VITE_TEAM_SUPABASE_ANON_KEY` | Supabase **publishable / anon 公共客户端值**，必须由所有者在平台内填写 |

不要填写模型 Key、`service_role` 或 `sb_secret_*`。构建会拒绝服务器密钥作为客户端配置。本构建不加载原应用的 `.env` 或其他 `VITE_*` 模型配置。首次发布得到 `pages.dev` 地址后填回 `PS_APP_URL` 和 `PS_ALLOWED_ORIGINS`；在 Supabase Auth 的 Redirect URLs 添加这个确切根地址，不改其他应用的 Site URL 或已有跳转列表。预览地址默认不能调用后台，需明确加入允许列表才可使用。

Cloudflare Git 集成负责每次推送自动发布；`Prompt Studio Team` GitHub Actions 负责校验并保留独立构建产物。不能因 CI 通过而声称数据库、函数或 Pages 已发布。

### 构建在安装依赖时失败：ERR_PNPM_UNSUPPORTED_ENGINE

若日志显示 Node `24.13.1`，以及 `nopt@10.0.1` 要求 `^24.15.0`，将 Cloudflare 的 `NODE_VERSION` 改为完整的 `24.22.1` 后保存并重新部署。只写 `24` 可能被平台解析成旧版本；环境变量会覆盖仓库的 `.node-version`。不要关闭 `engine-strict` 或绕过依赖检查。此错误出现在前端构建之前，与模型凭据无关。

## 4. 首位管理员与成员邀请

由所有者在 Supabase Authentication 创建/确认自己的应用账号，然后执行下面查询，仅将自己已有账号加入工作室。替换邮箱，不更改 Auth 的其他用户和密码：

```sql
insert into public.ps_members(user_id,email,role)
select id,email,'admin' from auth.users where email='YOUR_ADMIN_EMAIL';
```

登录工作室后进入团队管理，输入成员邮箱与 12 至 128 位初始密码即可创建成员。成员直接用邮箱、密码登录，右上角可修改自己的密码。管理员可在成员列表停用/启用成员，或为本工作室新创建的普通成员重设密码。密码仅经 HTTPS 发往后台 Auth，不写入应用表、浏览器存储、导出或日志；界面提交后会清空密码字段。请私下交付初始密码。

已存在的 Supabase 用户使用“已有账号？使用邀请链接加入”，保留其原有密码；已有用户不会自动成为本应用成员。为避免影响同项目其他应用，管理员不能在这里重设已有共享账号或其他管理员的密码，只能重设带服务端工作室创建标记的普通成员账号。共享账号由成员本人登录后自行修改。新成员固定为普通成员，不接受客户端传入的管理员角色。

邀请链接私下交给对应成员；无需免费 SMTP，也不会由系统自动群发邮件。停用成员会撤回本应用数据访问。不要在日志、公共 PR 或导出中保存密码或邀请链接。首次管理员账号仍由项目所有者在 Supabase 创建/确认，其后成员管理均在网站内完成。

忘记密码时，在登录页填写邮箱，点击“忘记密码 / 首次设置密码”，由用户自己打开恢复邮件并设置密码。恢复链接明确回到当前站点，须先添加该网址到 Redirect URLs；不修改共享项目的默认 Site URL。邮件发送受 Supabase 当前邮件配置、收件人限制和限流影响。该入口统一提示，不披露账号是否存在；发送失败不会自动重试。

## 数据、额度与边界

- 默认每日不限；管理员可设置正数上限，0 为不限。个人同时1项、团队同时2项用于防瞬间拥堵，可由管理员调整。自定义正数每日上限按北京时间重置；已接收失败请求也计次，兼容回退仍为一次操作。这些是本站设置，不读取供应商余额。
- 私人作品和图像只对所属成员可见。团队库保存提示词快照，默认不共享原图或私人原始需求；只有明确勾选才授权团队读图。撤回后旧签名链接最长仍可用 60 秒。
- 图片只接受 PNG/JPEG、单张 10MB 以内、最多五张；浏览器重编码并缩放至长边 2048px，去除元数据；服务器验证文件签名和全部图像 20MB 上限。原始高分辨率文件请保留在自己的资料库。已生成版本的图片顺序不可直接替换，添加或调整顺序请新建作品；用途说明可以修改，旧分析会失效。
- 修改建议绑定被分析版本和需求，输入变化后必须重新分析。多标签同时编辑时，后到结果保存为分支，不替换当前版本。恢复旧版本会产生新版本。
- 后续改写以当前完整版本为基线，提示词明确禁止无关精简或细节遗漏。参考图改写与建议应用若丢失已有 JSON 字段，后台拒绝保存并明确提示，不自动重复付费调用；语义细节可通过保留的版本对比核验。
- 导出包含本人的提示词、版本、分析和精简文字经验，排除会话、服务配置、邀请、图片签名链接和密钥；图片文件不包含在导出中。应用无自动备份承诺，可定期导出并另行使用平台备份机制。
- 新图不会写入Storage，放弃新创作也不会遗留云端图片。此前版本上传的旧图和孤立文件仍保留，管理员可核对引用后另行清理；本次不执行删除。完整文字历史仍会增长，精简记忆的16KB上限不等于全部历史数据有固定大小。

## 验收

```bash
pnpm typecheck:team
pnpm test:team
node scripts/sync-team-templates.mjs --check
deno check --config supabase/functions/prompt-studio-api/deno.json supabase/functions/prompt-studio-api/index.ts
pnpm build:team
node scripts/check-team-dist.mjs
```

再用两位成员测试：另一人的作品/原图不可见；主动分享的提示词可复制；未勾选时图片不可见；撤回共享后访问恢复私有。用产品图、空间图、复杂光线图分别测试提炼、保留机位修改材质、三格式一致性、评分、建议修改和版本恢复。重新打开网页验证云端记录，并从团队实际网络测试访问。使用服务器已有配置完成模型测试，不读取或截图密钥。

回滚前端使用 Cloudflare 既有部署回滚；后台可回滚函数版本。数据库新增表不自动删除，保留团队数据并停止入口即可。

