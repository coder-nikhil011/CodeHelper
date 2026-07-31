# DSA AI Mentor — Browser Extension

> **An AI-powered Hinglish mentor that helps you solve DSA problems on LeetCode, HackerRank, and GeeksforGeeks — without revealing the full solution.**

![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20%7C%20Firefox-blue)
![Language](https://img.shields.io/badge/Language-Hinglish-orange)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🖼️ Screenshots](#️-screenshots)
- [🚀 Installation](#-installation)
- [🔑 API Key Setup](#-api-key-setup)
- [🎮 How to Use](#-how-to-use)
- [⚡ Quick Actions](#-quick-actions)
- [📁 Project Structure](#-project-structure)
- [🌐 Supported Platforms](#-supported-platforms)
- [⚙️ Customization](#️-customization)
- [🛠️ Tech Stack](#️-tech-stack)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

# ✨ Features

✅ **Problem Samjhao**
- Automatically detects the problem
- Explains it in simple Hinglish

✅ **Brute Force First**
- Encourages logical thinking
- Guides you from brute force to optimized solution

✅ **Smart Stuck Detection**
- Detects when you're stuck
- Gives hints after inactivity or repeated mistakes

✅ **Three Help Modes**
- 💡 Guiding Questions
- 📝 Step-by-Step Guidance
- 📹 Video Recommendations

✅ **Cross Browser Support**
- Chrome
- Edge
- Firefox

---

# 🖼️ Screenshots

> Add your screenshots here.

### Sidebar

```
images/sidebar.png
```

### Popup

```
images/popup.png
```

### Mentor in Action

```
images/demo.gif
```

---

# 🚀 Installation

## Chrome / Edge

1. Open

```
chrome://extensions/
```

2. Enable **Developer Mode**

3. Click **Load unpacked**

4. Select

```
dsa-mentor-extension/
```

5. Pin the extension.

---

## Firefox

Open

```
about:debugging#/runtime/this-firefox
```

Click

```
Load Temporary Add-on
```

Select

```
manifest.json
```

---
Here is the updated **API Key Setup** section you can drop straight into your `README.md`:

---

### 🔑 API Key Setup

1. Open the extension popup by clicking the **DSA AI Mentor** icon in your browser toolbar.
2. Get a free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).
3. Paste your key into the **Gemini API Key** field.
4. Click **Save API Key**.

---

# 🎮 How to Use

1. Open any problem on:
   - LeetCode
   - HackerRank
   - GeeksforGeeks

2. The sidebar opens automatically.

3. Click

```
Start Karo
```

4. Start learning with the AI mentor.

---

# ⚡ Quick Actions

| Button | Action |
|---------|--------|
| 💡 Brute Force | Learn the brute-force approach |
| 📦 Data Structure | Get the best data structure suggestion |
| 🔍 Hint Do | Receive a hint |
| 📹 Video | Watch a related tutorial |

---

# 📁 Project Structure

```text
dsa-mentor-extension/
│
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── styles.css
├── icons/
└── README.md
```

---

# 🌐 Supported Platforms

| Platform | Status |
|----------|--------|
| ✅ LeetCode | Supported |
| ✅ HackerRank | Supported |
| ✅ GeeksforGeeks | Supported |

---

# ⚙️ Customization

Edit

```js
getDSAMentorSystemPrompt()
```

inside

```
content.js
```

to customize the mentor's behavior.

---

# 🛠️ Tech Stack

- JavaScript
- HTML
- CSS
- Browser Extension APIs
- Anthropic Claude API

---

# 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a new branch
3. Commit your changes
4. Open a Pull Request

---

# 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">

## ❤️ Made for DSA Learners

**Happy Coding! 🚀**

</div>
