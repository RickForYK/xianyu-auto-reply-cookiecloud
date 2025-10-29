# 图标文件说明

插件需要以下三种尺寸的图标文件：

- `icon16.png` - 16x16像素（浏览器工具栏显示）
- `icon48.png` - 48x48像素（扩展程序管理页面）
- `icon128.png` - 128x128像素（Chrome网上应用店）

## 快速生成图标

### 方法1: 在线生成
访问以下网站生成图标：
- https://www.favicon-generator.org/
- https://www.iconsgenerator.com/

### 方法2: 使用Python生成（推荐）

在 `browser-extension/icons/` 目录下运行以下Python脚本：

```python
from PIL import Image, ImageDraw, ImageFont

def create_icon(size):
    # 创建渐变背景
    img = Image.new('RGB', (size, size), color='white')
    draw = ImageDraw.Draw(img)
    
    # 绘制渐变背景
    for y in range(size):
        r = int(102 + (118 - 102) * y / size)
        g = int(126 + (75 - 126) * y / size)
        b = int(234 + (162 - 234) * y / size)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    
    # 绘制圆形
    circle_margin = size // 4
    draw.ellipse(
        [circle_margin, circle_margin, size - circle_margin, size - circle_margin],
        fill='white',
        outline=None
    )
    
    # 保存
    img.save(f'icon{size}.png', 'PNG')
    print(f'已生成 icon{size}.png')

# 生成三种尺寸
for size in [16, 48, 128]:
    create_icon(size)

print('所有图标已生成完成！')
```

### 方法3: 临时使用单色图标

如果你暂时不需要精美图标，可以使用简单的单色方块：

```python
from PIL import Image

for size in [16, 48, 128]:
    img = Image.new('RGB', (size, size), color='#667eea')
    img.save(f'icon{size}.png')
```

## 注意事项

1. 图标必须是PNG格式
2. 图标背景建议不透明（更好的兼容性）
3. 设计要简洁清晰，在小尺寸下也能看清
4. 建议使用品牌主色调：#667eea（紫色）

## 如果没有图标会怎样？

浏览器会显示一个默认的扩展程序图标（拼图形状），不影响功能使用。

