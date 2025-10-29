"""项目启动入口：

1. 创建 CookieManager，按配置文件 / 环境变量初始化账号任务
2. 在后台线程启动 FastAPI (reply_server) 提供管理与自动回复接口
3. 主协程保持运行
"""

import os
import sys
import asyncio
import threading
import uvicorn
from urllib.parse import urlparse
from pathlib import Path
from loguru import logger

# 修复Linux环境下的asyncio子进程问题
if sys.platform.startswith('linux'):
    try:
        # 在程序启动时就设置正确的事件循环策略
        asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())
        logger.debug("已设置事件循环策略以支持子进程")
    except Exception as e:
        logger.debug(f"设置事件循环策略失败: {e}")

from config import AUTO_REPLY, COOKIES_LIST
import cookie_manager as cm
from db_manager import db_manager
from file_log_collector import setup_file_logging
from usage_statistics import report_user_count

# 新增：CookieCloud 支持
# 注意：此文件位于 replace/Start.py，替换后对应 import 为 utils.cookiecloud
try:
    from utils.cookiecloud import fetch_cookiecloud_cookie_str
except Exception:
    # 在未替换前的运行环境下，避免导入错误导致崩溃
    fetch_cookiecloud_cookie_str = None
    logger.warning("utils.cookiecloud 未就绪，CookieCloud 同步将被跳过")


def _start_api_server():
    """后台线程启动 FastAPI 服务"""
    api_conf = AUTO_REPLY.get('api', {})

    # 优先使用环境变量配置
    host = os.getenv('API_HOST', '0.0.0.0')  # 默认绑定所有接口
    port = int(os.getenv('API_PORT', '8080'))  # 默认端口8080

    # 如果配置文件中有特定配置，则使用配置文件
    if 'host' in api_conf:
        host = api_conf['host']
    if 'port' in api_conf:
        port = api_conf['port']

    # 兼容旧的URL配置方式
    if 'url' in api_conf and 'host' not in api_conf and 'port' not in api_conf:
        url = api_conf.get('url', 'http://0.0.0.0:8080/xianyu/reply')
        parsed = urlparse(url)
        if parsed.hostname and parsed.hostname != 'localhost':
            host = parsed.hostname
        port = parsed.port or 8080

    logger.info(f"启动Web服务器: http://{host}:{port}")
    uvicorn.run("reply_server:app", host=host, port=port, log_level="info")


def load_keywords_file(path: str):
    """从文件读取关键字 -> [(keyword, reply)]"""
    kw_list = []
    p = Path(path)
    if not p.exists():
        return kw_list
    with p.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '\t' in line:
                k, r = line.split('\t', 1)
            elif ' ' in line:
                k, r = line.split(' ', 1)
            elif ':' in line:
                k, r = line.split(':', 1)
            else:
                continue
            kw_list.append((k.strip(), r.strip()))
    return kw_list


async def _cookiecloud_refresh_loop(manager: "cm.CookieManager",
                                    cookie_id: str,
                                    host: str,
                                    uuid: str,
                                    password: str,
                                    refresh_seconds: int):
    """
    后台定时从 CookieCloud 拉取并覆盖指定账号 Cookie。
    - 若拉取失败则跳过该轮，保留现有 Cookie。
    - 若成功，则调用 manager.update_cookie 以热重启该账号任务。
    """
    if not fetch_cookiecloud_cookie_str:
        logger.warning("CookieCloud 模块不可用，停止刷新循环")
        return

    refresh_seconds = max(60, int(refresh_seconds or 1800))  # 最小 60 秒
    logger.info(f"CookieCloud 刷新任务已启动：账号={cookie_id}，间隔={refresh_seconds}s")

    while True:
        try:
            await asyncio.sleep(refresh_seconds)
            cookies_str = await fetch_cookiecloud_cookie_str(host, uuid, password, timeout=20)
            if not cookies_str:
                logger.warning("CookieCloud 刷新失败，本轮跳过")
                continue

            logger.info(f"CookieCloud 刷新成功，准备覆盖账号 {cookie_id} 的 Cookie")
            # 如任务已启动，用更新接口热重启；否则只更新数据库与内存，后续由启动流程接管
            if cookie_id in getattr(manager, "tasks", {}):
                manager.update_cookie(cookie_id, cookies_str)
            else:
                # 未启动阶段：仅覆盖内存与数据库
                try:
                    details = db_manager.get_cookie_details(cookie_id)
                    user_id = details.get('user_id') if details else None
                except Exception:
                    user_id = None
                db_manager.save_cookie(cookie_id, cookies_str, user_id)
                manager.cookies[cookie_id] = cookies_str
                logger.info(f"已覆盖数据库与内存中的 Cookie（未启动阶段）: {cookie_id}")
        except asyncio.CancelledError:
            logger.info("CookieCloud 刷新任务已取消")
            break
        except Exception as e:
            logger.error(f"CookieCloud 周期刷新异常: {e}")


async def _setup_cookiecloud_before_start(manager: "cm.CookieManager"):
    """
    若配置了环境变量（COOKIE_CLOUD_HOST/UUID/PASSWORD），
    则在启动任务前拉取 Cookie 并覆盖指定账号（默认优先覆盖 'default' 或唯一账号）。
    之后按 COOKIE_CLOUD_REFRESH_SECONDS 开启后台刷新。
    未配置时，不做任何改动，沿用原有 Cookie。
    """
    if not fetch_cookiecloud_cookie_str:
        logger.info("未提供 CookieCloud 模块，跳过云端同步")
        return

    host = (os.getenv("COOKIE_CLOUD_HOST") or "").strip()
    uuid = (os.getenv("COOKIE_CLOUD_UUID") or "").strip()
    password = (os.getenv("COOKIE_CLOUD_PASSWORD") or "").strip()
    refresh_seconds = os.getenv("COOKIE_CLOUD_REFRESH_SECONDS") or os.getenv("COOKIE_CLOUD_REFRESH_INTERVAL") or "1800"
    cookie_id_env = (os.getenv("COOKIE_CLOUD_COOKIE_ID") or "").strip()
    refresh_on_token_failure_only = os.getenv("COOKIE_REFRESH_ON_TOKEN_FAILURE_ONLY", "true").lower() in ("true", "1", "t")
 
    # 未配置 CookieCloud，跳过
    if not host or not uuid:
        logger.info("未配置 CookieCloud 环境变量，沿用本地 Cookie")
        return

    try:
        refresh_seconds = int(refresh_seconds)
    except Exception:
        refresh_seconds = 1800

    logger.info("检测到 CookieCloud 配置，开始首次拉取并覆盖本地 Cookie")

    # 选择目标 cookie_id
    target_cookie_id = None
    if cookie_id_env:
        target_cookie_id = cookie_id_env
    elif "default" in manager.cookies:
        target_cookie_id = "default"
    elif len(manager.cookies) == 1:
        target_cookie_id = list(manager.cookies.keys())[0]
    else:
        # 多账号场景且未指定，默认采用 default（不存在则创建）
        target_cookie_id = "default"

    # 首次拉取
    cookies_str = await fetch_cookiecloud_cookie_str(host, uuid, password, timeout=20)
    if not cookies_str:
        logger.warning("CookieCloud 首次拉取失败，保持原有 Cookie，不开启刷新")
        return

    # 覆盖数据库与内存中的 Cookie，暂不启动任务（交由后续统一启动逻辑）
    try:
        details = db_manager.get_cookie_details(target_cookie_id)
        user_id = details.get('user_id') if details else None
    except Exception:
        user_id = None

    db_manager.save_cookie(target_cookie_id, cookies_str, user_id)
    manager.cookies[target_cookie_id] = cookies_str

    logger.info(f"CookieCloud 首次同步完成，已覆盖账号 {target_cookie_id} 的 Cookie，长度={len(cookies_str)}")

    # 启动后台刷新任务
    # 启动后台刷新任务
    if refresh_seconds > 0 and not refresh_on_token_failure_only:
        asyncio.create_task(
            _cookiecloud_refresh_loop(manager, target_cookie_id, host, uuid, password, refresh_seconds)
        )
    elif refresh_on_token_failure_only:
        logger.info("已配置为仅在 Token 刷新失败时更新 Cookie，后台定时刷新已禁用")


async def main():
    print("开始启动主程序...")

    # 初始化文件日志收集器
    print("初始化文件日志收集器...")
    setup_file_logging()
    logger.info("文件日志收集器已启动，开始收集实时日志")

    loop = asyncio.get_running_loop()

    # 创建 CookieManager 并在全局暴露
    print("创建 CookieManager...")
    cm.manager = cm.CookieManager(loop)
    manager = cm.manager
    print("CookieManager 创建完成")

    # 在启动任务前：若环境已配置 CookieCloud，则拉取并覆盖 Cookie（否则保留原逻辑）
    try:
        await _setup_cookiecloud_before_start(manager)
    except Exception as e:
        logger.error(f"启动前 CookieCloud 同步失败：{e}，将沿用本地 Cookie")

    # 1) 从数据库加载的 Cookie 已经在 CookieManager 初始化时完成
    # 为每个启用的 Cookie 启动任务
    for cid, val in manager.cookies.items():
        # 检查账号是否启用
        if not manager.get_cookie_status(cid):
            logger.info(f"跳过禁用的 Cookie: {cid}")
            continue

        try:
            # 直接启动任务，不重新保存到数据库
            from db_manager import db_manager
            logger.info(f"正在获取Cookie详细信息: {cid}")
            cookie_info = db_manager.get_cookie_details(cid)
            user_id = cookie_info.get('user_id') if cookie_info else None
            logger.info(f"Cookie详细信息获取成功: {cid}, user_id: {user_id}")

            logger.info(f"正在创建异步任务: {cid}")
            task = loop.create_task(manager._run_xianyu(cid, val, user_id))
            manager.tasks[cid] = task
            logger.info(f"启动数据库中的 Cookie 任务: {cid} (用户ID: {user_id})")
            logger.info(f"任务已添加到管理器，当前任务数: {len(manager.tasks)}")
        except Exception as e:
            logger.error(f"启动 Cookie 任务失败: {cid}, {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")

    # 2) 如果配置文件中有新的 Cookie，也加载它们
    for entry in COOKIES_LIST:
        cid = entry.get('id')
        val = entry.get('value')
        if not cid or not val or cid in manager.cookies:
            continue

        kw_file = entry.get('keywords_file')
        kw_list = load_keywords_file(kw_file) if kw_file else None
        manager.add_cookie(cid, val, kw_list)
        logger.info(f"从配置文件加载 Cookie: {cid}")

    # 3) 若老环境变量仍提供单账号 Cookie，则作为 default 账号
    env_cookie = os.getenv('COOKIES_STR')
    if env_cookie and 'default' not in manager.list_cookies():
        manager.add_cookie('default', env_cookie)
        logger.info("从环境变量加载 default Cookie")

    # 启动 API 服务线程
    print("启动 API 服务线程...")
    threading.Thread(target=_start_api_server, daemon=True).start()
    print("API 服务线程已启动")

    # 上报用户统计
    try:
        await report_user_count()
    except Exception as e:
        logger.debug(f"上报用户统计失败: {e}")

    # 阻塞保持运行
    print("主程序启动完成，保持运行...")
    await asyncio.Event().wait()


if __name__ == '__main__':
    asyncio.run(main())