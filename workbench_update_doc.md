# Workbench AI 文件操作功能更新文档

本文档记录了为 `novel-meon` Workbench 的 AI 助手添加的文件操作增强功能，重点在于实现“在文件中间追加内容”的需求。

## 1. 概述

为了提升 AI 助手在代码编辑和文档编写中的灵活性，我们扩展了其文件操作能力。除了原有的 `read` (读取) 和 `write` (覆盖写入) 操作外，新增了 `append` (追加) 和 `replace` (替换/插入) 操作。

特别是 `replace` 操作，通过“查找与替换”的机制，巧妙地解决了在无行号系统中精准定位并插入内容的问题。

## 2. 核心变更

所有的修改主要集中在 `apps/web/components/workbench/workbench.tsx` 文件中。

### 2.1 新增操作类型

在 `executeFsAction` 函数中增加了对以下类型的处理：

*   **`append`**: 将新内容追加到文件末尾。
*   **`replace`**: 在文件中查找指定字符串，并将其替换为新内容。此功能可用于：
    *   **替换**: 将旧内容完全替换为新内容。
    *   **插入**: 将 `搜索字符串` 替换为 `搜索字符串 + 新内容`，从而实现“在指定位置后插入”。

**代码片段 (`executeFsAction`):**

```typescript
} else if (type === "replace") {
    const currentContent = window.localStorage.getItem(`${key}:markdown`) ?? "";
    const searchStr = options?.search;
    if (!searchStr) return "Error: Missing 'search' attribute for replace action.";
    
    // 安全性优化：使用回调函数避免特殊字符（如 $&, $1）被错误解析
    finalContent = currentContent.replace(searchStr, () => fileContent);
}
```

### 2.2 增强正则解析

为了支持 `replace` 操作所需的额外属性（`search="..."`），我们将 `sendMessage` 函数中的正则表达式从固定属性匹配改为更灵活的属性解析。

**旧正则**: 仅匹配 `type` 和 `path`。
**新正则**: 
```typescript
const actionRegex = /<file_action(\s+[^>]+)(?:>([\s\S]*?)<\/file_action>|\s*\/?>)/g;
```
该正则首先捕获所有属性字符串，然后通过辅助函数提取 `type`, `path`, `search` 等属性。

### 2.3 更新 System Prompt

系统提示词已更新，明确告知 AI 新的能力和使用规范：

```markdown
To append to a file:
<file_action type="append" path="folder/filename.md">
CONTENT_TO_APPEND
</file_action>

To replace content in a file (can be used to insert):
<file_action type="replace" path="folder/filename.md" search="STRING_TO_FIND">
REPLACEMENT_STRING
</file_action>
```

## 3. 使用示例

### 场景 1: 在文件末尾添加日志

**AI 输出:**
```xml
<file_action type="append" path="logs/runtime.log">
[INFO] Process started successfully.
</file_action>
```

### 场景 2: 在特定标题后插入内容 (中间追加)

假设 `README.md` 内容为：
```markdown
# Title
Introduction text.
```

**AI 输出:**
```xml
<file_action type="replace" path="README.md" search="# Title">
# Title

## Subtitle
New inserted section.
</file_action>
```
**结果:**
```markdown
# Title

## Subtitle
New inserted section.
Introduction text.
```

## 4. 总结

通过引入 `replace` 机制，我们避免了依赖不稳定的行号定位，提供了一种鲁棒的、上下文感知的局部文件修改方案。这使得 AI 能够更精准地协助用户进行代码重构和文档编辑。
