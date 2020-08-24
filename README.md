# Empty Node.JS Project

空 Node.JS 项目。

这里包含基础 Node.JS 代码库，可用于 Web（含 WebSocket）、TCP、UDP、Socket 的连接，支持多节点、多进程与多线程，以及 MySQL、Redis 的基础功能。

-	作者：Lostabaddon
-	版本：0.1.7

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
4.	支持简单的多节点集群响应，可根据集群响应速度自动调配任务（Galanet 模块）
	-	提供服务的节点才能成为集群友机，从而被其它友机服务
	-	可设置响应的服务类型（根路径为类型名）
	-	支持 Http、TCP、UDP 三种方式进行节点通讯
	-	支持纯网关代理模式
	-	支持等待任务池
5.	支持控制台响应
	-	查看本地各进程、集群中各节点的负载情况
	-	增加、移除 Galanet 节点
	-	关闭当前节点或全网
6.	支持接口响应的预处理与后处理，并支持热更新
7.	日志模块
	-	多进程统一日志显示
	-	可配置的日志显示记录
	-	输出到文件
	-	线程处理

## 子分支

### withDB

该分支提供 MySQl 和 Redis 支持，以及一些基于它们的基础功能。

-	MySQL 模块
	基于 Node-MySQL 库
-	Redis 模块
	基于 Node-Redis 库
-	缓存关联表（withDB: working）
	使用 Redis 对 MySQL 做缓存，并自动管理过期时间

## 计划

-	增加全局状态变量 (master: working)
-	API 端口的访问闸限流机制，避免并发过高 (mater)
-	使用序列化手段做进程间通讯即节点间通讯 (master)
-	增加 Ising 协议，用于分布式共识 (master)
-	多节点数据用socket中转而非读取后写出到端 (master)
-	主分支：支持根据任务类型进行多节点任务调配，而非统一任务调配

## 代码仓库

-	github 地址：https://github.com/LostAbaddon/EmptyNodeProject
-	coding.net 地址：https://lostabaddon.coding.net/p/emptynodeproject