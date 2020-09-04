# Empty Node.JS Project

空 Node.JS 项目。

这里包含基础 Node.JS 代码库，可用于 Web（含 WebSocket）、TCP、UDP、Socket 的连接，支持多节点、多进程与多线程。withDB 分支更支持 MySQL、Redis、SimpleCachedTable 等基础功能。

-	作者：Lostabaddon
-	版本：0.2.0

## 功能

1.	目录即路径，方便开发管理
	-	静态文件的目录化管理与响应
	-	API 模块的目录化管理与响应
	-	支持 API 模块的热更新
		+	支持 JS 模块更新（JS、MJS、CJS文件）
		+	支持 JSON 数据更新
	-	支持非 API 模块文件的自动加载与热更新（以“_”开头的文件不会作为 WebAPI 接口文件加载，而作为普通 JS 模块加载）
2.	支持 Http、Https、WebSocket、TCP、UDP、Linuxsock/pipe 连接
3.	支持多进程响应，并根据各进程的工作情况自动调配任务
	-	可动态调整业务进程数（以单进程模式启动的不行，设置命令：console local set-process x），也可通过控制台重启所有业务进程（重启命令：console local refresh）
	-	可动态设置每个业务进程的并发请求数（设置命令：console local set-concurrence x）
4.	支持简单的多节点集群响应，可根据集群响应速度自动调配任务（Galanet 模块）
	-	提供服务的节点才能成为集群友机，从而被其它友机服务
	-	可设置响应的服务类型（根路径为类型名）
	-	支持 Http、TCP、UDP 三种方式进行节点通讯
	-	支持纯网关代理模式
	-	支持等待任务池
	-	公钥匹配的ID管理模式，并支持加密通讯（可生成公私钥对并读取，但需自己调用加密模块）
	-	采用自研 Quark 数据结构与 Atom 数据类进行通讯
5.	支持多线程与多进程混合模式
	-	业务响应模式分为：
		1.	进程执行模式（SPE: Single Process Execution，标记为 process）
			默认执行方式，在业务进程中响应请求，不启用线程
		2.	一次性线程执行模式（OTE: One-time Thread Execution，标记为 thread_once）
			每次响应事务都会新开启一根线程，执行结束后返回结果并销毁线程
		3.	事务线程池执行模式（TTP: Transaction Thread Pool，标记为 tx_thread_pool）
			每个 API 模块一根独立线程
		4.	驻守线程池执行模式（CTP: Common Thread Pool，标记为 cm_thread_pool）
			全局统一线程池
6.	支持控制台响应
	-	查看本地各进程、集群中各节点的负载情况（查看命令：console stat usage、console stat cluster）
	-	增加、移除 Galanet 节点（增删命令：console network --add xxx、console network --remove xxx）
	-	关闭当前节点或全网（命令：console shutdown、console shutdown --all）
7.	支持接口响应的预处理与后处理，并支持热更新
8.	日志模块
	-	多进程统一日志显示
	-	可配置的日志显示记录
	-	输出到文件
	-	线程处理

### 架构图

整个项目的基本结构，是主进程监听所有外源（Http 与 Https 包括 Web 和 WebSocket、TCP、UDP、管道）请求，然后通过负载均衡机制分发给各业务响应节点，业务节点收到请求后，通过负载均衡将请求分派给各业务子进程。

同时，主进程也会监听并响应来自命令行的控制命令。

而在启用 withDB 分支中，主进程和子进程都会连接到数据库服务器（MySQL 和 Redis），由后者（单节点或集群都可以）提供统一服务。

如果业务以 CPU 密集型请求的响应为主，那业务进程的数量不建议超过 CPU 的数量减 1（如果服务器上还需要跑别的 CPU 密集型服务，则还需进一步减少）。同时，如果不是 CPU 密集型业务，业务进程也启动线程池来响应业务。线程池模块有，但默认不加载，使用的时候可以根据情况决定是否使用线程池。

同时，每个节点各自也可以对外接受请求然后发布给网络中的其它节点协同处理。数据的同步完全由数据库节点/集群来控制。

**单进程单节点模式：**

```
HTTP(webSocket) —┐
TCP —————————————┼—: 总入口 :——: 处理模块 :
UDP —————————————┤
pipe/socket —————┘
```

**多进程单节点模式：**

```
HTTP(webSocket) —┐　　　　　　　　　　　　　　　　　┌— 进程1 : 业务入口 :——: 处理模块 :
TCP —————————————┼—: 总入口 :——: 进程负载均衡 :——┼— 进程2 : 业务入口 :——: 处理模块 :
UDP —————————————┤　　　　　　　　　　　　　　　　　├— …………
pipe/socket —————┘　　　　　　　　　　　　　　　　　└— 进程N : 业务入口 :——: 处理模块 :
```

**多进程多节点模式：**

```
HTTP(webSocket) —┐　　　　　　　　　　　　　　　　 ┌— 节点1 : 业务入口 :——: 进程负载均衡 :——: 处理模块 :
TCP —————————————┼—: 总入口 :——: 节点负载均衡 :——┼— 节点2 : 业务入口 :——: 进程负载均衡 :——: 处理模块 :
UDP —————————————┤　　　　　　　　　　　│　　　　　├— …………
pipe/socket —————┘　　　　　　　　　　　│　　　　　└— 进程N : 业务入口 :——: 进程负载均衡 :——: 处理模块 :
　　　　　　　　　　　　　　　　　　　　　│
　　　　　　　　　　　　　　　　　　　　　│
　　　　　　　　　　　　　　　　　　　　　│　　　　　　　　　　　　　　　　┌— 进程1 : 业务入口 :——: 处理模块 :
　　　　　　　　　　　　　　　　　　　　　└—: 本地 :——: 进程负载均衡 :——┼— 进程2 : 业务入口 :——: 处理模块 :
　　　　　　　　　　　　　　　　　　　　　 　　　　　　　　　　　　　　　　├— …………
　　　　　　　　　　　　　　　　　　　　　 　　　　　　　　　　　　　　　　└— 进程N : 业务入口 :——: 处理模块 :
```

**多进程多节点独立网关模式：**

```
HTTP(webSocket) —┐　　　　　　　　　　　　　　　　 ┌— 节点1 : 业务入口 :——: 处理模块 :
TCP —————————————┼—: 总入口 :——: 节点负载均衡 :——┼— 节点2 : 业务入口 :——: 处理模块 :
UDP —————————————┤　　　　　　　　　　　 　　　　　├— …………
pipe/socket —————┘　　　　　　　　　　　 　　　　　└— 进程N : 业务入口 :——: 处理模块 :
```

## 子分支

### withDB

该分支提供 MySQl 和 Redis 支持，以及一些基于它们的基础功能。

-	MySQL 模块
	基于 Node-MySQL 库，将部分库中接口异步化。
-	Redis 模块
	基于 Node-Redis 库，将部分库中接口异步化。
-	简单缓存关联表（SCT）
	使用 Redis 对 MySQL 做缓存，并自动管理过期时间。
	+	大周期（longExpire）：Redis 自动过期的时长
	+	小周期（shortExpire）：读取数据时的被模块自动过期的时长
	+	周期盐（saltExpire）：在大小周期上的随机浮动范围，避免大量键同时过期导致的问题

## Galanet 与 Ising 网络

一个简单的分布式网络。

Galanet 是内网系统，节点之间彼此信任；Ising 是外网系统，通讯都需要认证。Ising 也负责共识。

## 计划

-	主分支：更好的线程管理 (working)
	+	一次性线程执行模式（OTE模式）
		-	业务进程支持OTE
	+	常驻线程池模式（TPE模式）
-	主分支：增加广播、窄播、特定节点播放以及加密通讯 (working)
-	withDB分支：SCT增加空值检测机制以防止缓存穿透攻击 (working)
-	withDB分支：SCT增加业务队列，避免缓存击穿和雪崩 (working)
-	withDB分支：SCT增加缓存预备锁，避免缓存击穿和雪崩 (working)
-	主分支：增加 Ising 协议，用于分布式共识
-	主分支：支持根据任务类型进行多节点任务调配，而非统一任务调配
-	主分支：多节点数据用socket中转而非读取后写出到端

## 代码仓库

-	github 地址：https://github.com/LostAbaddon/EmptyNodeProject
-	coding.net 地址：https://lostabaddon.coding.net/p/emptynodeproject