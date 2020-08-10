# Empty Node.JS Project

空 Node.JS 项目。

这里包含基础 Node.JS 代码库，可用于 Web（含 WebSocket）、TCP、UDP、Socket 的连接，支持多节点、多进程与多线程。

-	作者：Lostabaddon
-	版本：0.1.3

## 功能

1.	目录即路径，方便开发管理
	-	静态文件的目录化管理与响应
	-	API 模块的目录化管理与响应
2.	支持 Http、Https、WebSocket、TCP、UDP、Linuxsock/pipe 连接
3.	支持多进程响应，并根据各进程的工作情况自动调配任务
4.	支持简单的多节点集群响应，可根据集群响应速度自动调配任务（Galanet 模块）
	-	提供服务的节点才能成为集群友机，从而被其它友机服务
	-	可设置响应的服务类型（根路径为类型名）
	-	支持 Http、TCP、UDP 三种方式进行节点通讯
	-	支持纯网关代理模式

## 计划

-	支持 API 模块的热更新（working）
-	支持控制台响应（working）
-	日志模块
-	MySQL 模块
-	Redis 模块
-	支持根据任务类型进行多节点任务调配，而非统一任务调配

## 代码仓库

-	github 地址：https://github.com/LostAbaddon/EmptyNodeProject
-	coding.net 地址：https://lostabaddon.coding.net/p/emptynodeproject