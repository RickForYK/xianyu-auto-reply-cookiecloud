
## 致谢

参考了以下项目，感谢提供思路：
- https://github.com/OnlineMo/Goofish-Auto-reply-replace
- https://github.com/zhinianboke/xianyu-auto-reply
- https://github.com/easychen/CookieCloud

## 环境

- 服务器
  - 部署xianyu-auto-reply
  - 部署cookiecloud容器
- 终端
  - 使用Chrome登录闲鱼Web
  - 使用插件对接cookiecloud

## 部署


- 服务器
  - 下载xianyu-auto-reply最新代码
  - 替换`XianyuAutoAsync.py`
  - 替换`Start.py`
  - 复制`cookiecloud.py`到`utils`目录
  - 部署`cookiecloud`容器
    - `docker run -p=8088:8088 easychen/cookiecloud:latest`

- 终端
  - chrome登录闲鱼web：`https://www.goofish.com/`
  - 登录后跳转到**消息**界面
  - chrome添加插件
    - cookiecloud
    - 闲鱼刷新助手
  - 打开插件`cookiecloud`
    - 替换服务器地址为上述cookiecloud容器地址，端口`8080`
    - 生成KEY和加密密码
    - 过期时间设置为60分钟
    - 同步域名关键词
      - goofish.com
    - 测试 -> 通过即可
    - 保存
  - 打开插件`闲鱼刷新助手`
    - 设置间隔时间区间
    - 正常刷新一下闲鱼的web界面应该会自动启动，如无自动启动可以手动启动

- 服务器
  - 添加`环境变量`
      - COOKIE_CLOUD_HOST: CookieCloud 容器地址（需带上端口号）
      - COOKIE_CLOUD_UUID: 浏览器插件中生成的UUID
      - COOKIE_CLOUD_PASSWORD: 浏览器插件中的生成密码
  - 测试环境变量生效后继续：
    - 运行`Start.py`即可

- 打包Docker
  - 替换好文件后，可自行修改原有DockerFile文件，创建镜像即可。
