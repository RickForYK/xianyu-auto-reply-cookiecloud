# -*- coding: utf-8 -*-
"""
CookieCloud 同步工具

支持两种返回：
1) 明文：POST /get/:uuid 携带 body {password}，返回 { cookie_data, local_storage_data }
2) 加密：返回 { encrypted: "...(base64 of Salted__ + salt + ciphertext)..." } 时，使用
   OpenSSL EVP_BytesToKey(MD5) 派生 (key, iv) 并 AES-256-CBC 解密，密码为 md5(f"{uuid}-{password}")[:16]

输出：可直接用于请求头/WS 的 cookies 字符串 ("k1=v1; k2=v2")
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from typing import Dict, List, Optional, Any, Tuple

from loguru import logger
import aiohttp

# cryptography 用于 AES-CBC 解密与 PKCS7 去填充
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes  # type: ignore
from cryptography.hazmat.backends import default_backend  # type: ignore


__all__ = ["fetch_cookiecloud_cookie_str", "build_cookie_str_from_cookie_data"]


def _normalize_host(host: str) -> str:
    if not host:
        return ""
    host = host.strip().rstrip("/")
    if not host.startswith("http://") and not host.startswith("https://"):
        host = "http://" + host
    return host


def _extract_cookie_data(payload: Any) -> Optional[Dict[str, List[dict]]]:
    """
    兼容多种返回格式，提取 cookie_data:
    - { cookie_data: {...}, local_storage_data: {...} }
    - { data: { cookie_data: {...}, ... } }
    - 其他：返回 None
    """
    try:
        obj = json.loads(payload) if isinstance(payload, str) else payload
    except Exception:
        return None

    if not isinstance(obj, dict):
        return None

    if "cookie_data" in obj and isinstance(obj["cookie_data"], dict):
        return obj["cookie_data"]

    if "data" in obj and isinstance(obj["data"], dict) and isinstance(obj["data"].get("cookie_data"), dict):
        return obj["data"]["cookie_data"]

    # 有些服务会返回 { encrypted: "..." }（未解密）
    if "encrypted" in obj:
        return None

    return None


def build_cookie_str_from_cookie_data(cookie_data: Dict[str, List[dict]], prefer_domains: Optional[List[str]] = None) -> str:
    """
    将 CookieCloud 的 cookie_data 转为标准 Cookie 字符串（name=value; ...）
    - 同名 key 以“偏好域名”优先，其次后写覆盖前写
    """
    prefer_domains = prefer_domains or [
        ".goofish.com",
        "goofish.com",
        "wss-goofish.dingtalk.com",
        ".alicdn.com",
        ".taobao.com",
    ]

    def domain_priority(domain: str) -> Tuple[int, int]:
        # 高优先级：命中 prefer_domains（越靠前优先级越高）
        for idx, d in enumerate(prefer_domains):
            if d in domain:
                return (0, idx)
        return (1, 999)

    cookies_ordered: List[Tuple[str, List[dict]]] = []
    for domain, items in (cookie_data or {}).items():
        if not isinstance(items, list):
            continue
        cookies_ordered.append((domain or "", items))

    # 根据偏好域名排序
    cookies_ordered.sort(key=lambda t: domain_priority(t[0]))

    kv: Dict[str, str] = {}
    for domain, items in cookies_ordered:
        for it in items:
            if not isinstance(it, dict):
                continue
            name = it.get("name") or it.get("key")
            value = it.get("value")
            if not name or value is None:
                continue
            # 跳过空值
            value_str = str(value)
            if value_str == "":
                continue
            kv[name] = value_str

    # 输出 name=value; name2=value2
    return "; ".join([f"{k}={v}" for k, v in kv.items()])


def _pkcs7_unpad(data: bytes, block_size: int = 16) -> bytes:
    if not data:
        raise ValueError("pkcs7: empty data")
    pad_len = data[-1]
    if pad_len <= 0 or pad_len > block_size:
        raise ValueError("pkcs7: invalid padding length")
    if data[-pad_len:] != bytes([pad_len]) * pad_len:
        raise ValueError("pkcs7: invalid padding bytes")
    return data[:-pad_len]


def _evp_bytes_to_key(password: bytes, salt: bytes, key_len: int = 32, iv_len: int = 16) -> Tuple[bytes, bytes]:
    """
    OpenSSL EVP_BytesToKey（MD5）实现，与 CryptoJS.AES(passphrase) 默认一致。
    返回 (key, iv)
    """
    if salt and len(salt) != 8:
        raise ValueError(f"salt length is {len(salt)}, expected 8")

    d = b""
    last = b""
    while len(d) < (key_len + iv_len):
        md5 = hashlib.md5()
        md5.update(last + password + (salt or b""))
        last = md5.digest()
        d += last
    return d[:key_len], d[key_len:key_len + iv_len]


def _decrypt_cryptojs_encrypted(encrypted_b64: str, passphrase: str) -> bytes:
    """
    解密 CryptoJS.AES.encrypt(msg, passphrase) 生成的密文（OpenSSL 兼容，带 "Salted__" 头）。
    """
    raw = base64.b64decode(encrypted_b64)
    if len(raw) < 16 or raw[:8] != b"Salted__":
        raise ValueError("invalid ciphertext header (missing 'Salted__')")

    salt = raw[8:16]
    ciphertext = raw[16:]

    key, iv = _evp_bytes_to_key(passphrase.encode("utf-8"), salt, key_len=32, iv_len=16)
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    return _pkcs7_unpad(padded, block_size=16)


async def _post_try_plain(session: aiohttp.ClientSession, url: str, password: str) -> Optional[dict]:
    """
    用 POST 方式提交 password 尝试让服务端直接返回明文。
    先以 x-www-form-urlencoded 提交，不行再 JSON。
    返回解析后的 JSON 对象或 None。
    """
    # 1) application/x-www-form-urlencoded
    try:
        async with session.post(url, data={"password": password}) as resp:
            text = await resp.text()
            if resp.status == 200:
                try:
                    return json.loads(text)
                except Exception:
                    logger.debug("CookieCloud POST form 返回非 JSON，尝试 JSON 提交")
            else:
                logger.debug(f"CookieCloud POST form 失败: HTTP {resp.status}, {text[:200]}")
    except Exception as e:
        logger.debug(f"CookieCloud POST form 异常: {e}")

    # 2) application/json
    try:
        async with session.post(url, json={"password": password}) as resp:
            text = await resp.text()
            if resp.status == 200:
                try:
                    return json.loads(text)
                except Exception:
                    logger.debug("CookieCloud POST json 返回非 JSON")
            else:
                logger.debug(f"CookieCloud POST json 失败: HTTP {resp.status}, {text[:200]}")
    except Exception as e:
        logger.debug(f"CookieCloud POST json 异常: {e}")

    return None


async def fetch_cookiecloud_cookie_str(host: str, uuid: str, password: str, timeout: int = 15) -> Optional[str]:
    """
    拉取 CookieCloud 数据并构造 Cookie 字符串。
    优先使用 POST 明文；若仍返回 {encrypted} 或 POST 不可用，则回退到 GET(加密) + 本地解密。
    返回:
        cookies_str 或 None
    """
    host = _normalize_host(host)
    if not host or not uuid:
        logger.warning("CookieCloud 配置不完整（host/uuid 缺失）")
        return None

    url = f"{host}/get/{uuid}"
    get_url = url  # GET 用于拉取 encrypted

    try:
        timeout_obj = aiohttp.ClientTimeout(total=timeout)
        async with aiohttp.ClientSession(timeout=timeout_obj) as session:
            # 1) 优先 POST 明文（服务端要求：GET 不能用于解密）
            if password:
                post_data = await _post_try_plain(session, url, password)
                if post_data is not None:
                    cookie_data = _extract_cookie_data(post_data)
                    if cookie_data:
                        cookies_str = build_cookie_str_from_cookie_data(cookie_data)
                        logger.info(f"CookieCloud 拉取成功（POST 明文），合并后 Cookie 长度: {len(cookies_str)}")
                        return cookies_str
                    # 如果 POST 返回了 encrypted，则继续走加密解密分支
                    if isinstance(post_data, dict) and isinstance(post_data.get("encrypted"), str):
                        logger.debug("CookieCloud POST 返回 encrypted，准备本地解密")
                        data = post_data
                    else:
                        data = None
                else:
                    data = None
            else:
                data = None

            # 2) 若 POST 不可用或未返回明文，则 GET 获取加密数据
            if data is None:
                async with session.get(get_url) as resp:
                    text = await resp.text()
                    if resp.status != 200:
                        logger.error(f"CookieCloud GET 请求失败: HTTP {resp.status}, 响应: {text[:200]}")
                        return None
                    try:
                        data = json.loads(text)
                    except Exception:
                        logger.error("CookieCloud GET 响应不是 JSON")
                        return None

            # 3) 处理加密分支（本地解密）
            if isinstance(data, dict) and isinstance(data.get("encrypted"), str):
                if not password:
                    logger.warning("CookieCloud 返回 encrypted，但未提供密码，无法解密。")
                    return None

                # 计算 passphrase：md5(f"{uuid}-{password}")[:16]
                passphrase = hashlib.md5(f"{uuid}-{password}".encode("utf-8")).hexdigest()[:16]
                try:
                    decrypted = _decrypt_cryptojs_encrypted(data["encrypted"], passphrase)
                    decrypted_text = decrypted.decode("utf-8", errors="ignore")
                    try:
                        decrypted_obj = json.loads(decrypted_text)
                    except Exception as e:
                        logger.error(f"CookieCloud 解密后 JSON 解析失败: {e}")
                        return None

                    cookie_data = _extract_cookie_data(decrypted_obj)
                    if not cookie_data:
                        logger.error(f"CookieCloud 解密后未找到 cookie_data 字段: {str(decrypted_obj)[:200]}")
                        return None

                    cookies_str = build_cookie_str_from_cookie_data(cookie_data)
                    logger.info(f"CookieCloud 解密成功，合并后 Cookie 长度: {len(cookies_str)}")
                    return cookies_str
                except Exception as e:
                    logger.error(f"CookieCloud 本地解密失败: {e}")
                    return None

            # 4) 明文但格式异常
            cookie_data = _extract_cookie_data(data)
            if cookie_data:
                cookies_str = build_cookie_str_from_cookie_data(cookie_data)
                logger.info(f"CookieCloud 拉取成功（明文），合并后 Cookie 长度: {len(cookies_str)}")
                return cookies_str

            logger.error(f"CookieCloud 返回格式无法识别: {str(data)[:200]}")
            return None

    except asyncio.TimeoutError:
        logger.error("CookieCloud 请求超时")
        return None
    except Exception as e:
        logger.error(f"CookieCloud 拉取异常: {e}")
        return None


# 可选：同步封装，便于在同步环境测试
def fetch_cookiecloud_cookie_str_sync(host: str, uuid: str, password: str, timeout: int = 15) -> Optional[str]:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # 嵌入到已运行的事件循环中由调用方处理
            logger.error("当前存在运行中的事件循环，无法直接同步调用 fetch_cookiecloud_cookie_str")
            return None
        return loop.run_until_complete(fetch_cookiecloud_cookie_str(host, uuid, password, timeout=timeout))
    except RuntimeError:
        return asyncio.run(fetch_cookiecloud_cookie_str(host, uuid, password, timeout=timeout))