#!/usr/bin/env python3

import argparse
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple


SUPPORTED_SUFFIXES = {
    ".kt": "Android",
    ".java": "Android",
    ".swift": "iOS",
    ".m": "iOS",
    ".mm": "iOS",
    ".h": "iOS",
    ".ets": "HarmonyOS",
    ".ts": "HarmonyOS",
}

DOC_SUFFIXES = {
    ".md",
    ".mdx",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
}

REFERENCE_SUFFIXES = set(SUPPORTED_SUFFIXES) | DOC_SUFFIXES

IGNORE_DIRS = {
    ".git",
    ".gradle",
    ".idea",
    ".svn",
    "Pods",
    "Carthage",
    "DerivedData",
    "build",
    "dist",
    "kotlin-js-store",
    "node_modules",
    "out",
    "target",
    "vendor",
}

PATH_HINTS = {
    "ability",
    "api",
    "base",
    "biz",
    "bridge",
    "common",
    "core",
    "feature",
    "foundation",
    "gateway",
    "helper",
    "hybrid",
    "infra",
    "kit",
    "lib",
    "middleware",
    "module",
    "network",
    "router",
    "sdk",
    "service",
    "shared",
    "store",
    "wrapper",
}

NEGATIVE_HINTS = {
    "activity",
    "appdelegate",
    "application",
    "atom",
    "attribute",
    "bean",
    "button",
    "cell",
    "comment",
    "constant",
    "constants",
    "controller",
    "data",
    "decoration",
    "decorator",
    "demo",
    "dialog",
    "dto",
    "entity",
    "enum",
    "event",
    "exception",
    "example",
    "fragment",
    "helper",
    "info",
    "layout",
    "listener",
    "message",
    "model",
    "observer",
    "page",
    "panel",
    "request",
    "response",
    "screen",
    "state",
    "style",
    "test",
    "toast",
    "view",
    "viewcontroller",
    "viewmodel",
    "widget",
}

MIDDLEWARE_SUFFIX_HINTS = {
    "adapter",
    "bridge",
    "channel",
    "client",
    "context",
    "coordinator",
    "dispatcher",
    "facade",
    "factory",
    "gateway",
    "handler",
    "interceptor",
    "kit",
    "manager",
    "middleware",
    "plugin",
    "processor",
    "provider",
    "registry",
    "repository",
    "router",
    "sdk",
    "service",
    "servicelocator",
    "singleton",
    "store",
    "tracker",
    "wrapper",
}

WRAPPER_HINTS = MIDDLEWARE_SUFFIX_HINTS | {
    "agent",
    "delegate",
    "engine",
    "helper",
    "hybrid",
    "logger",
    "module",
    "monitor",
    "proxy",
    "publisher",
}

ARCHITECTURE_HINTS = {
    "architecture",
    "bus",
    "channel",
    "config",
    "contract",
    "coordinator",
    "databus",
    "dispatcher",
    "framework",
    "gateway",
    "handler",
    "hybrid",
    "interceptor",
    "ipc",
    "lifecycle",
    "middleware",
    "mvi",
    "mvp",
    "mvvm",
    "network",
    "permission",
    "protocol",
    "provider",
    "processor",
    "publisher",
    "report",
    "reporter",
    "repository",
    "rpc",
    "router",
    "schema",
    "standard",
    "subscriber",
}

SERVICE_HINTS = (
    "client",
    "facade",
    "gateway",
    "manager",
    "provider",
    "sdk",
    "service",
    "rpc",
    "ipc",
)

STANDARD_HINTS = (
    "config",
    "contract",
    "protocol",
    "rule",
    "schema",
    "spec",
    "standard",
)

FRAMEWORK_HINTS = {
    "architecture",
    "coordinator",
    "framework",
    "lifecycle",
    "mvi",
    "mvp",
    "mvvm",
    "reducer",
    "servicelocator",
    "state",
    "store",
    "viewmodel",
}

COMMUNICATION_HINTS = (
    "bridge",
    "bus",
    "channel",
    "databus",
    "dispatcher",
    "event",
    "ipc",
    "message",
    "router",
)

PRACTICE_HINTS = (
    "best",
    "guideline",
    "practice",
    "principle",
    "recommendation",
    "规范",
    "指南",
    "最佳实践",
)

DESIGN_FOLLOW_HINTS = {
    "architecture",
    "best",
    "contract",
    "design",
    "follow",
    "framework",
    "guideline",
    "pattern",
    "practice",
    "rule",
    "schema",
    "spec",
    "standard",
    "规范",
    "标准",
    "最佳实践",
    "接入说明",
}

STRONG_NAME_HINTS = DESIGN_FOLLOW_HINTS | set(STANDARD_HINTS) | FRAMEWORK_HINTS

UI_COMPONENT_HINTS = {
    "activity",
    "button",
    "cell",
    "dialog",
    "fragment",
    "icon",
    "image",
    "item",
    "label",
    "layout",
    "list",
    "page",
    "panel",
    "popup",
    "screen",
    "style",
    "tab",
    "text",
    "toast",
    "view",
    "viewgroup",
    "widget",
}

GENERIC_DOC_TITLES = {
    "readme",
    "index",
    "overview",
    "changelog",
    "license",
    "contributing",
    "todo",
}

DOC_STANDARD_KEYWORDS = {
    "schema",
    "spec",
    "standard",
    "protocol",
    "contract",
    "rule",
    "guideline",
    "best practice",
    "最佳实践",
    "规范",
    "标准",
    "约定",
    "接入说明",
}

DOC_ENTRY_SIGNAL_PHRASES = {
    "禁止直接",
    "不要直接",
    "统一使用",
    "必须使用",
    "请使用",
    "接入",
    "引用",
    "封装",
    "标准",
    "规范",
    "最佳实践",
    "best practice",
    "guideline",
    "wrapper",
    "middleware",
    "sdk",
    "gateway",
}

NEGATIVE_DOC_PHRASES = {
    "不要直接",
    "禁止直接",
    "deprecated",
    "avoid",
    "do not",
}

SCHEME_SIGNAL_PHRASES = {
    "must follow",
    "should follow",
    "统一接入",
    "统一使用",
    "必须使用",
    "接入规范",
    "最佳实践",
    "标准",
    "规范",
}

EXACT_DESIGN_NAMES = {
    "ServiceLocator",
    "AppRouter",
    "ModuleRouter",
    "BridgeManager",
    "GatewayService",
    "NetworkManager",
    "AnalyticsTracker",
    "PermissionManager",
    "LogReporter",
    "DataBus",
    "EventBus",
    "Middleware",
}

ANNOTATION_MIDDLEWARE_SIGNALS = {
    # DI frameworks
    "Binds",
    "Component",
    "HiltViewModel",
    "Inject",
    "Module",
    "Provides",
    "Singleton",
    # Spring-style
    "Service",
    "Repository",
    "Controller",
    # Custom / project-level
    "SDK",
    "Middleware",
    "Gateway",
    "Bridge",
    "Api",
    # HarmonyOS
    "Entry",
}

GENERIC_NOISE_NAMES = {
    "Activity",
    "Application",
    "AppDelegate",
    "BaseActivity",
    "BaseFragment",
    "Button",
    "Cell",
    "Controller",
    "Data",
    "Entity",
    "Event",
    "Exception",
    "Fragment",
    "Item",
    "Model",
    "Page",
    "Request",
    "Response",
    "State",
    "Style",
    "View",
    "ViewController",
    "ViewModel",
    "Widget",
}

GENERIC_SCOPE_PARTS = {
    "src",
    "main",
    "java",
    "kotlin",
    "swift",
    "objc",
    "ios",
    "android",
    "harmony",
    "ets",
    "app",
    "apps",
    "common",
    "shared",
    "source",
    "sources",
}

MODULE_PRIORITY = {
    "feature",
    "features",
    "module",
    "modules",
    "biz",
    "business",
    "component",
    "components",
    "service",
    "services",
    "library",
    "libraries",
    "packages",
}

JAVA_PACKAGE_PREFIXES = {"com", "org", "net", "cn", "io", "me", "dev"}

FUNCTIONAL_MODULE_NAMES = {
    "api",
    "arch",
    "base",
    "bridge",
    "bus",
    "cache",
    "channel",
    "component",
    "config",
    "controller",
    "data",
    "database",
    "di",
    "domain",
    "gateway",
    "hybrid",
    "interceptor",
    "lifecycle",
    "manager",
    "message",
    "middleware",
    "model",
    "monitor",
    "msg",
    "network",
    "permission",
    "plugin",
    "protocol",
    "push",
    "report",
    "repository",
    "router",
    "rpc",
    "sdk",
    "service",
    "services",
    "share",
    "state",
    "store",
    "test",
    "tests",
    "tracker",
    "ui",
    "utils",
    "util",
    "view",
    "widget",
    "commonmain",
    "androidmain",
    "iosmain",
    "shared",
}

PLATFORM_BUILTINS = {
    "Activity",
    "Application",
    "Bundle",
    "Context",
    "Fragment",
    "Intent",
    "NSObject",
    "String",
    "UIView",
    "UIViewController",
    "View",
}

TOKEN_EXPANSIONS = {
    "ability": ["ability", "capability", "能力", "权限能力", "业务能力"],
    "account": ["login", "user", "auth", "profile", "me", "账号", "用户", "登录"],
    "adapter": ["adapter", "encapsulation", "适配", "适配器", "封装"],
    "analytics": ["track", "event", "report", "metrics", "埋点", "上报", "统计"],
    "architecture": ["architecture", "framework", "架构", "框架", "基础设施"],
    "auth": ["login", "token", "oauth", "session", "鉴权", "认证", "授权"],
    "bridge": ["jsbridge", "hybrid", "webview", "h5", "native", "桥接", "容器"],
    "block": ["block", "view block", "区块", "页面区块"],
    "cache": ["storage", "persist", "memory cache", "disk cache", "缓存", "存储"],
    "channel": ["channel", "message channel", "通道", "消息通道"],
    "client": ["sdk", "api", "service access", "客户端", "接入层"],
    "component": ["component", "module", "组件", "模块"],
    "config": ["settings", "feature flag", "remote config", "配置", "配置中心"],
    "coordinator": ["coordinator", "navigation coordinator", "协调器", "流程协调"],
    "contract": ["contract", "api contract", "契约", "协议约定"],
    "databus": ["data bus", "event bus", "数据总线", "事件总线"],
    "dispatcher": ["dispatcher", "event dispatcher", "分发", "调度"],
    "dialog": ["popup", "modal", "alert", "弹窗"],
    "engine": ["engine", "runtime", "引擎"],
    "event": ["event", "event bus", "事件", "消息"],
    "feature": ["feature", "capability", "功能", "能力"],
    "framework": ["framework", "architecture", "框架", "架构"],
    "gateway": ["gateway", "service gateway", "网关", "入口"],
    "handler": ["handler", "message handler", "处理器"],
    "helper": ["helper", "utility", "工具"],
    "hybrid": ["h5", "webview", "jsbridge", "bridge", "混合", "容器"],
    "image": ["image loader", "image cache", "图片", "图片加载"],
    "interceptor": ["interceptor", "拦截", "拦截器"],
    "ipc": ["ipc", "process communication", "跨进程"],
    "kit": ["kit", "sdk", "工具包"],
    "lifecycle": ["lifecycle", "生命周期"],
    "log": ["logger", "debug", "trace", "日志"],
    "logger": ["log", "debug", "trace", "monitor", "日志", "监控"],
    "manager": ["manager", "service", "管理器"],
    "message": ["message", "event", "消息", "事件"],
    "middleware": ["middleware", "wrapper", "封装", "中间件"],
    "monitor": ["metrics", "trace", "apm", "observe", "监控", "可观测"],
    "mvp": ["mvp", "model view presenter", "架构"],
    "mvvm": ["mvvm", "viewmodel", "架构"],
    "nav": ["navigation", "router", "route", "deeplink", "导航", "路由"],
    "network": ["api", "http", "request", "response", "网络", "接口", "请求"],
    "permission": ["privacy", "camera", "location", "notification", "权限", "隐私"],
    "processor": ["processor", "pipeline", "处理"],
    "protocol": ["protocol", "standard", "协议", "标准"],
    "report": ["report", "tracking", "上报"],
    "reducer": ["reducer", "state reducer", "状态"],
    "repository": ["repository", "data access", "仓储", "数据访问"],
    "request": ["api", "http", "network", "response", "请求"],
    "rpc": ["rpc", "remote procedure call", "远程调用"],
    "rule": ["rule", "policy", "规则", "策略"],
    "schema": ["schema", "contract", "结构约定"],
    "sdk": ["sdk", "kit", "工具包"],
    "service": ["client", "api", "gateway", "facade", "服务", "服务接入"],
    "servicelocator": ["service locator", "locator", "服务定位"],
    "singleton": ["singleton", "instance", "单例"],
    "spec": ["spec", "standard", "规范"],
    "standard": ["standard", "rule", "标准"],
    "state": ["state", "store", "状态"],
    "storage": ["cache", "persist", "kv", "database", "存储", "数据库"],
    "track": ["analytics", "event", "report", "metrics", "埋点"],
    "tracker": ["analytics", "event", "report", "metrics", "埋点"],
    "user": ["account", "profile", "login", "session", "用户"],
    "web": ["webview", "h5", "hybrid", "browser", "网页"],
    "webview": ["h5", "hybrid", "browser", "jsbridge", "webview"],
    "viewmodel": ["viewmodel", "state", "store", "页面状态"],
    "wrapper": ["wrapper", "encapsulation", "封装"],
}

PLATFORM_KEYWORDS = {
    "Android": [
        "android",
        "安卓",
    ],
    "iOS": [
        "ios",
        "iphone",
        "苹果",
    ],
    "HarmonyOS": [
        "harmony",
        "鸿蒙",
    ],
    "KMP": [
        "kmp",
        "kotlin multiplatform",
        "跨端",
    ],
}

CHINESE_PHRASE_EXPANSIONS = {
    "中间件": [
        "middleware",
        "wrapper",
        "封装",
    ],
    "消息": [
        "message",
        "event",
        "事件",
    ],
    "网络": [
        "network",
        "api",
        "http",
        "网络层",
    ],
    "路由": [
        "router",
        "navigation",
        "route",
    ],
    "容器": [
        "container",
        "hybrid",
        "webview",
    ],
    "埋点": [
        "analytics",
        "track",
        "report",
    ],
    "配置": [
        "config",
        "feature flag",
        "配置中心",
    ],
    "通信": [
        "communication",
        "event",
        "bus",
    ],
    "服务框架": [
        "service framework",
        "service",
        "framework",
    ],
    "页面框架": [
        "view framework",
        "mvvm",
        "mvi",
    ],
    "架构": [
        "architecture",
        "framework",
    ],
    "总线": [
        "bus",
        "event bus",
        "message bus",
    ],
    "最佳实践": [
        "best practice",
        "guideline",
    ],
    "方案": [
        "solution",
        "implementation",
    ],
    "规范": [
        "standard",
        "rule",
        "spec",
    ],
    "协议": [
        "standard",
        "rule",
        "protocol",
    ],
    "状态管理": [
        "state management",
        "store",
        "state",
    ],
    "设计方案": [
        "design solution",
        "implementation design",
    ],
    "接入标准": [
        "integration standard",
        "standard",
    ],
}

SPECIAL_CASE_KEYWORDS: Dict[str, List[str]] = {
    "ServiceLocator": [
        "service locator",
        "locator",
        "服务定位",
    ],
    "EventBus": [
        "event bus",
        "message bus",
        "事件总线",
    ],
    "DataBus": [
        "data bus",
        "event bus",
        "数据总线",
    ],
    "AppRouter": [
        "app router",
        "应用路由",
    ],
    "ModuleRouter": [
        "module router",
        "模块路由",
    ],
    "BridgeManager": [
        "bridge manager",
        "桥接管理",
    ],
    "GatewayService": [
        "gateway service",
        "网关服务",
    ],
    "NetworkManager": [
        "network manager",
        "网络管理",
    ],
    "AnalyticsTracker": [
        "analytics tracker",
        "埋点追踪",
    ],
    "PermissionManager": [
        "permission manager",
        "权限管理",
    ],
}

HARMONY_PATH_SIGNALS = ("harmony", "oh_modules", "oh-package", "/ets/", "hvigor", "build-profile")
KMP_PATH_SIGNALS = ("commonmain", "androidmain", "iosmain", "shared/src", "kmm", "kmp")

REFERENCE_SYMBOL_PATTERN = re.compile(r"\b[A-Z][A-Za-z0-9_]{2,}\b|[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_]{1,}")
DOC_COMMENT_LINE = re.compile(r"^\s*(///|//|/\*+|\*|#)\s?(.*)")
ANNOTATION_LINE = re.compile(r"^\s*@([A-Za-z_][A-Za-z0-9_.]*)")

IMPORT_PATTERNS = {
    ".kt": re.compile(r"^\s*import\s+([A-Za-z0-9_.*.]+)", re.MULTILINE),
    ".java": re.compile(r"^\s*import\s+([A-Za-z0-9_.*.]+)", re.MULTILINE),
    ".swift": re.compile(r"^\s*import\s+([A-Za-z0-9_]+)", re.MULTILINE),
    ".ets": re.compile(r"^\s*import\s+(?:.*?\s+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE),
    ".ts": re.compile(r"^\s*import\s+(?:.*?\s+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE),
}

OBJC_IMPORT_PATTERN = re.compile(r"^\s*#import\s+[<\"]([^>\"]+)[>\"]|^\s*@import\s+([A-Za-z0-9_.]+)", re.MULTILINE)

SINGLETON_PATTERNS = (
    re.compile(r"\bcompanion\s+object\b.*?\b(?:getInstance|instance|INSTANCE|shared|default)\b", re.DOTALL),
    re.compile(r"\bstatic\s+(?:let|var)\s+shared\s*="),
    re.compile(r"\bstatic\s+func\s+(?:shared|getInstance|instance)\s*\("),
    re.compile(r"\b(?:@objc\s+)?class\s+func\s+(?:shared|default)\s*\("),
    re.compile(r"\bINSTANCE\b"),
    re.compile(r"\b(?:val|var)\s+\w+\s*:\s*\w+\s+by\s+lazy\s*\("),
)

DECLARATION_PATTERNS = [
    re.compile(
        r"(?m)^\s*(?:public|private|protected|internal|open|final|abstract|sealed|data|enum|annotation|static|\s)*"
        r"\b(?:class|interface|protocol|struct|enum|object)\s+([A-Z][A-Za-z0-9_]*)"
    ),
    re.compile(r"(?m)^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|type)\s+([A-Z][A-Za-z0-9_]*)"),
]

INHERITANCE_PATTERNS = [
    re.compile(r"(?m)^\s*(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|final\s+|abstract\s+|sealed\s+|data\s+)*class\s+([A-Z][A-Za-z0-9_]*)[^{\n:]*:\s*([A-Z][A-Za-z0-9_]*)"),
    re.compile(r"(?m)^\s*(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+)*class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+([A-Z][A-Za-z0-9_]*)"),
    re.compile(r"(?m)^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+([A-Z][A-Za-z0-9_]*)"),
]


@dataclass
class FileRecord:
    path: Path
    root: Path
    text: str
    suffix: str
    platform: Optional[str] = None
    module_name: str = ""
    is_doc: bool = False
    reference_symbols: Set[str] = field(default_factory=set)
    import_symbols: Set[str] = field(default_factory=set)


@dataclass
class RawCandidate:
    name: str
    path: Path
    root: Path
    path_tokens: List[str]
    platform: str
    oss_hits: Set[str]
    score: int
    source_kind: str = "code"
    category_hint: str = ""
    canonical_name: str = ""
    strong_signal: bool = False


@dataclass
class DeclarationInfo:
    name: str
    doc_comment: str
    annotations: List[str]
    context_text: str


@dataclass
class Candidate:
    name: str
    category: str
    score: int
    keywords: List[str] = field(default_factory=list)
    possible_oss_wrapper: bool = False
    oss_hits: Set[str] = field(default_factory=set)
    platforms: Set[str] = field(default_factory=set)
    reference_files: int = 0
    reference_modules: int = 0
    cross_module_references: int = 0
    reference_docs: int = 0
    strong_signal: bool = False
    primary_path: Optional[Path] = None


def split_identifier(value: str) -> List[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value)
    spaced = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]+", " ", spaced)
    return [token.lower() for token in spaced.split() if token]


def contains_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def spaced_identifier(value: str) -> str:
    tokens = split_identifier(value)
    return " ".join(tokens)


def normalize_phrase(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_doc_title(value: str) -> str:
    cleaned = re.sub(r"[_\-]+", " ", value)
    cleaned = re.sub(r"\.(md|mdx|txt|json|ya?ml)$", "", cleaned, flags=re.IGNORECASE)
    return normalize_phrase(cleaned.strip(" :：|-"))


_CANONICAL_ALIASES: Dict[str, str] = {
    "service locator": "ServiceLocator",
    "servicelocator": "ServiceLocator",
    "event bus": "EventBus",
    "databus": "DataBus",
    "data bus": "DataBus",
    "app router": "AppRouter",
    "module router": "ModuleRouter",
}


def canonicalize_candidate_name(name: str) -> str:
    key = normalize_phrase(spaced_identifier(name)).lower()
    return _CANONICAL_ALIASES.get(key, name)


def add_keyword(target: List[str], seen: Set[str], value: str) -> None:
    clean = normalize_phrase(value)
    key = clean.lower()
    if not clean or key in seen:
        return
    seen.add(key)
    target.append(clean)


def load_oss_signals(reference_path: Path) -> Dict[str, Dict[str, Sequence[str]]]:
    if not reference_path.exists():
        return {}
    with reference_path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        return {}
    return payload


def is_ignored_path(path: Path) -> bool:
    return any(part in IGNORE_DIRS or part.startswith(".") for part in path.parts)


def iter_files_with_rg(root: Path, suffixes: Set[str]) -> Iterable[Path]:
    if root.is_file():
        if root.suffix in suffixes:
            yield root
        return
    if shutil.which("rg") is None:
        return
    try:
        result = subprocess.run(
            ["rg", "--files", "."],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return
    for line in result.stdout.splitlines():
        relative = Path(line.strip())
        if not line or is_ignored_path(relative) or relative.suffix not in suffixes:
            continue
        yield root / relative


def iter_files(roots: Sequence[Path], suffixes: Set[str]) -> Iterable[Path]:
    for root in roots:
        yielded: Set[Path] = set()
        for path in iter_files_with_rg(root, suffixes):
            yielded.add(path)
            yield path
        if yielded:
            continue
        if root.is_file() and root.suffix in suffixes:
            yield root
            continue
        for current_root, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                dirname
                for dirname in dirnames
                if dirname not in IGNORE_DIRS and not dirname.startswith(".")
            ]
            for filename in filenames:
                path = Path(current_root) / filename
                if path.suffix not in suffixes:
                    continue
                yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def extract_reference_symbols(text: str) -> Set[str]:
    return set(REFERENCE_SYMBOL_PATTERN.findall(text)) - PLATFORM_BUILTINS


def extract_imports(text: str, suffix: str) -> List[str]:
    if suffix in {".m", ".mm", ".h"}:
        imports: List[str] = []
        for match in OBJC_IMPORT_PATTERN.finditer(text):
            imports.extend(part for part in match.groups() if part)
        return imports
    pattern = IMPORT_PATTERNS.get(suffix)
    if not pattern:
        return []
    return pattern.findall(text)


def extract_import_symbols(text: str, suffix: str) -> Set[str]:
    imports = extract_imports(text, suffix)
    symbols: Set[str] = set()
    for imp in imports:
        parts = re.split(r"[./]", imp)
        for part in reversed(parts):
            if part and part[0].isupper() and part not in PLATFORM_BUILTINS:
                symbols.add(part)
                break
    return symbols


def infer_platform(path: Path, suffix: str) -> Optional[str]:
    path_lower = str(path).lower()
    if suffix in {".kt", ".java"}:
        if "iosmain" in path_lower:
            return "iOS"
        if any(signal in path_lower for signal in KMP_PATH_SIGNALS):
            if "commonmain" in path_lower or "/shared" in path_lower:
                return "KMP"
        return "Android"
    if suffix in {".swift", ".m", ".mm", ".h"}:
        return "iOS"
    if suffix == ".ets":
        return "HarmonyOS"
    if suffix == ".ts":
        if any(signal in path_lower for signal in HARMONY_PATH_SIGNALS):
            return "HarmonyOS"
        return None
    return None


def extract_doc_comment(lines: List[str], decl_line_idx: int) -> Tuple[str, List[str]]:
    comment_lines: List[str] = []
    annotations: List[str] = []
    idx = decl_line_idx - 1
    consecutive_blanks = 0
    while idx >= 0:
        stripped = lines[idx].strip()
        if not stripped:
            consecutive_blanks += 1
            if consecutive_blanks > 2:
                break
            idx -= 1
            continue
        consecutive_blanks = 0
        ann_match = ANNOTATION_LINE.match(stripped)
        if ann_match:
            annotations.append(ann_match.group(1))
            idx -= 1
            continue
        if DOC_COMMENT_LINE.match(stripped):
            comment_lines.append(stripped)
            idx -= 1
            continue
        break
    comment_lines.reverse()
    annotations.reverse()
    return "\n".join(comment_lines), annotations


def infer_module_name(path: Path, root: Path) -> str:
    try:
        parts = list(path.relative_to(root).parts[:-1])
    except ValueError:
        parts = list(path.parts[:-1])
    lowered_parts = [part.lower() for part in parts]
    skip_set = GENERIC_SCOPE_PARTS | JAVA_PACKAGE_PREFIXES

    for index, lower in enumerate(lowered_parts):
        if lower not in MODULE_PRIORITY:
            continue
        for sub_idx, candidate in enumerate(lowered_parts[index + 1 :], start=index + 1):
            if candidate in FUNCTIONAL_MODULE_NAMES:
                rest = [
                    p
                    for p in lowered_parts[sub_idx + 1 :]
                    if p not in skip_set and p not in FUNCTIONAL_MODULE_NAMES
                ]
                if rest:
                    return f"{candidate}:{rest[0]}"
                return candidate
        for candidate in lowered_parts[index + 1 :]:
            if candidate not in skip_set:
                return f"{lower}:{candidate}"
        return lower

    for i, part in enumerate(lowered_parts):
        if part in FUNCTIONAL_MODULE_NAMES:
            rest = [
                p
                for p in lowered_parts[i + 1 :]
                if p not in skip_set and p not in FUNCTIONAL_MODULE_NAMES
            ]
            if rest:
                return f"{part}:{rest[0]}"
            return part

    scoped = [p for p in lowered_parts if p not in skip_set]
    if len(scoped) >= 2:
        return ":".join(scoped[-2:])
    if scoped:
        return scoped[-1]
    return lowered_parts[0] if lowered_parts else "root"


def collect_path_tokens(path: Path, root: Path) -> List[str]:
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        parts = path.parts
    tokens: List[str] = []
    for part in parts:
        stem = Path(part).stem
        tokens.extend(split_identifier(stem))
    return tokens


def compile_reference_pattern(candidate_name: str) -> re.Pattern[str]:
    if contains_cjk(candidate_name):
        return re.compile(re.escape(candidate_name))
    return re.compile(r"\b" + re.escape(candidate_name) + r"\b")


def collect_file_records(roots: Sequence[Path], include_docs: bool = False) -> List[FileRecord]:
    records: List[FileRecord] = []
    suffixes = REFERENCE_SUFFIXES if include_docs else set(SUPPORTED_SUFFIXES)
    for root in roots:
        for path in iter_files([root], suffixes):
            text = read_text(path)
            if not text:
                continue
            suffix = path.suffix
            is_code = suffix in SUPPORTED_SUFFIXES
            records.append(
                FileRecord(
                    path=path,
                    root=root,
                    text=text,
                    suffix=suffix,
                    platform=infer_platform(path, suffix) if is_code else None,
                    module_name=infer_module_name(path, root),
                    is_doc=suffix in DOC_SUFFIXES,
                    reference_symbols=extract_reference_symbols(text),
                    import_symbols=extract_import_symbols(text, suffix) if is_code else set(),
                )
            )
    return records


def extract_declarations(text: str) -> List[DeclarationInfo]:
    lines = text.splitlines()
    file_header = "\n".join(lines[: min(10, len(lines))])
    declarations: List[DeclarationInfo] = []
    seen: Set[str] = set()
    for pattern in DECLARATION_PATTERNS:
        for match in pattern.finditer(text):
            name = next((group for group in reversed(match.groups()) if group), "")
            if not name or name in seen:
                continue
            seen.add(name)
            line_idx = text.count("\n", 0, match.start())
            doc_comment, annotations = extract_doc_comment(lines, line_idx)
            body_end = min(line_idx + 16, len(lines))
            body_preview = "\n".join(lines[line_idx:body_end])
            declarations.append(
                DeclarationInfo(
                    name=name,
                    doc_comment=doc_comment,
                    annotations=annotations,
                    context_text=doc_comment + "\n" + body_preview + "\n" + file_header,
                )
            )
    return declarations


def match_oss_libraries(
    text: str,
    imports: Sequence[str],
    signals: Dict[str, Dict[str, Sequence[str]]],
) -> Set[str]:
    haystack = "\n".join(imports) + "\n" + text
    hits: Set[str] = set()
    for library, payload in signals.items():
        for pattern in payload.get("patterns", []):
            if pattern and pattern in haystack:
                hits.add(library)
                break
    return hits


def detect_doc_category(text: str) -> str:
    lowered = text.lower()
    if "最佳实践" in text or "best practice" in lowered or "guideline" in lowered:
        return "最佳实践"
    if any(keyword in lowered for keyword in ("schema", "spec", "standard", "rule", "protocol")) or any(
        keyword in text for keyword in ("规范", "标准", "约定", "接入说明")
    ):
        return "标准"
    return "最佳实践"


def has_design_signal(text: str, name_tokens: Sequence[str], path_tokens: Sequence[str]) -> bool:
    lowered = text.lower()
    joined = "".join(name_tokens)
    if joined in {name.lower() for name in EXACT_DESIGN_NAMES}:
        return True
    if any(phrase.lower() in lowered for phrase in SCHEME_SIGNAL_PHRASES):
        return True
    return any(token in DESIGN_FOLLOW_HINTS for token in name_tokens) or any(
        token in DESIGN_FOLLOW_HINTS for token in path_tokens
    )


def collect_banned_identifiers(file_records: Sequence[FileRecord], local_declared_names: Set[str]) -> Set[str]:
    banned: Set[str] = set()
    banned_phrase = re.compile(r"禁止直接/不要直接|不要直接使用|禁止直接使用")
    for record in file_records:
        if not record.is_doc:
            continue
        for line in record.text.splitlines():
            match = banned_phrase.search(line)
            if not match:
                continue
            tail = line[match.end() :]
            for identifier in re.findall(r"\b[A-Z][A-Za-z0-9_]{2,}\b", tail):
                if identifier in local_declared_names:
                    banned.add(identifier)
                    banned.add(canonicalize_candidate_name(identifier))
    return banned


def extract_doc_candidates(record: FileRecord, local_declared_names: Set[str]) -> List[RawCandidate]:
    if not record.is_doc and record.suffix not in {".json", ".yaml", ".yml"}:
        return []

    path_tokens = collect_path_tokens(record.path, record.root)
    stem = normalize_doc_title(record.path.stem)
    doc_candidates: List[Tuple[str, str, int]] = []

    def maybe_add(name: str, category: str, score: int) -> None:
        cleaned = normalize_doc_title(name)
        lowered = cleaned.lower()
        if not cleaned:
            return
        if lowered in GENERIC_DOC_TITLES:
            return
        if not any(keyword in lowered for keyword in DOC_STANDARD_KEYWORDS) and not any(
            keyword in cleaned for keyword in ("最佳实践", "指南", "规范", "标准", "约定", "接入说明")
        ):
            return
        doc_candidates.append((cleaned, category, score))

    heading_hits = 0
    for heading in re.findall(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", record.text, re.MULTILINE):
        normalized = normalize_doc_title(heading)
        if not normalized:
            continue
        category = detect_doc_category(normalized)
        maybe_add(normalized, category, 4)
        heading_hits += 1

    if heading_hits == 0 or record.suffix in {".json", ".yaml", ".yml"}:
        stem_category = detect_doc_category(stem)
        maybe_add(stem, stem_category, 3)

    for line in record.text.splitlines():
        lowered_line = line.lower()
        if not any(phrase.lower() in lowered_line for phrase in DOC_ENTRY_SIGNAL_PHRASES):
            continue
        positive_segment = line
        for phrase in NEGATIVE_DOC_PHRASES:
            marker = positive_segment.lower().find(phrase)
            if marker >= 0:
                positive_segment = positive_segment[:marker]
        identifiers = re.findall(r"\b[A-Z][A-Za-z0-9_]{2,}\b|[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_]{1,}", positive_segment)
        for identifier in identifiers:
            normalized_identifier = normalize_phrase(identifier)
            if normalized_identifier in local_declared_names or contains_cjk(normalized_identifier):
                maybe_add(normalized_identifier, detect_doc_category(line), 5)

    deduped: Dict[str, Tuple[str, int]] = {}
    for name, category, score in doc_candidates:
        key = name.lower()
        previous = deduped.get(key)
        if previous is None or score > previous[1]:
            deduped[key] = (category, score)

    results: List[RawCandidate] = []
    for name, (category, score) in deduped.items():
        results.append(
            RawCandidate(
                name=name,
                path=record.path,
                root=record.root,
                path_tokens=path_tokens,
                platform=record.platform or "",
                oss_hits=set(),
                score=score,
                source_kind="doc",
                category_hint=category,
                canonical_name=canonicalize_candidate_name(name),
                strong_signal=True,
            )
        )
    return results


def is_middleware_candidate(
    name_tokens: Sequence[str],
    path_tokens: Sequence[str],
    oss_hits: Set[str],
    text: str,
) -> bool:
    if not name_tokens:
        return False
    token_set = set(name_tokens)
    path_set = set(path_tokens)
    if token_set & NEGATIVE_HINTS and not (token_set & MIDDLEWARE_SUFFIX_HINTS):
        return False
    if token_set & MIDDLEWARE_SUFFIX_HINTS:
        return True
    if token_set & ARCHITECTURE_HINTS:
        return True
    if path_set & PATH_HINTS and token_set & {"manager", "service", "router", "gateway", "bridge", "sdk"}:
        return True
    if oss_hits and token_set & {"manager", "adapter", "bridge", "wrapper", "service", "client"}:
        return True
    lowered = text.lower()
    return any(phrase.lower() in lowered for phrase in SCHEME_SIGNAL_PHRASES)


def classify_candidate(name_tokens: Sequence[str], path_tokens: Sequence[str]) -> str:
    token_set = set(name_tokens) | set(path_tokens)
    if token_set & set(STANDARD_HINTS):
        return "标准"
    if token_set & FRAMEWORK_HINTS or token_set & set(PRACTICE_HINTS):
        return "最佳实践"
    return "技术封装"


def score_candidate(
    name: str,
    name_tokens: Sequence[str],
    path_tokens: Sequence[str],
    oss_hits: Set[str],
    context_text: str,
    annotations: Sequence[str],
) -> int:
    score = 0
    token_set = set(name_tokens)
    path_set = set(path_tokens)
    if name in EXACT_DESIGN_NAMES:
        score += 4
    if token_set & MIDDLEWARE_SUFFIX_HINTS:
        score += 3
    if token_set & WRAPPER_HINTS:
        score += 2
    if token_set & set(SERVICE_HINTS):
        score += 2
    if token_set & set(STANDARD_HINTS):
        score += 2
    if token_set & FRAMEWORK_HINTS:
        score += 2
    if token_set & set(COMMUNICATION_HINTS):
        score += 1
    if token_set & set(PRACTICE_HINTS):
        score += 1
    if token_set & ARCHITECTURE_HINTS:
        score += 2
    if path_set & PATH_HINTS:
        score += 1
    if oss_hits:
        score += 2
    if annotations:
        score += 1
    if any(annotation.split(".")[-1] in ANNOTATION_MIDDLEWARE_SIGNALS for annotation in annotations):
        score += 2
    if has_design_signal(context_text, name_tokens, path_tokens):
        score += 3
    if token_set & NEGATIVE_HINTS and not token_set & MIDDLEWARE_SUFFIX_HINTS:
        score -= 3
    return score


def build_keywords(
    name: str,
    name_tokens: Sequence[str],
    path_tokens: Sequence[str],
    platforms: Sequence[str],
    oss_hits: Sequence[str],
    signals: Dict[str, Dict[str, Sequence[str]]],
    category: str,
) -> List[str]:
    keywords: List[str] = []
    seen: Set[str] = set()

    def add_expansions(token: str) -> None:
        normalized = token.lower()
        for expanded in TOKEN_EXPANSIONS.get(normalized, []):
            add_keyword(keywords, seen, expanded)
        for phrase, expansions in CHINESE_PHRASE_EXPANSIONS.items():
            if phrase in token:
                add_keyword(keywords, seen, phrase)
                for expanded in expansions:
                    add_keyword(keywords, seen, expanded)
        for expanded in SPECIAL_CASE_KEYWORDS.get(token, []):
            add_keyword(keywords, seen, expanded)

    add_keyword(keywords, seen, name)
    add_keyword(keywords, seen, category)
    for token in name_tokens:
        if token in MIDDLEWARE_SUFFIX_HINTS or token in ARCHITECTURE_HINTS or token in STRONG_NAME_HINTS:
            add_keyword(keywords, seen, token)
        add_expansions(token)
    for token in path_tokens:
        if token in PATH_HINTS or token in ARCHITECTURE_HINTS:
            add_keyword(keywords, seen, token)
        add_expansions(token)
    for platform in platforms:
        add_keyword(keywords, seen, platform)
        for keyword in PLATFORM_KEYWORDS.get(platform, []):
            add_keyword(keywords, seen, keyword)
    for hit in oss_hits:
        add_keyword(keywords, seen, f"{hit} wrapper")
        payload = signals.get(hit, {})
        for keyword in payload.get("keywords", [])[:3]:
            add_keyword(keywords, seen, keyword)
    return keywords


def build_import_popularity_index(file_records: Sequence[FileRecord]) -> Dict[str, Dict[str, Set[str]]]:
    index: Dict[str, Dict[str, Set[str]]] = {}
    for record in file_records:
        for symbol in record.import_symbols:
            entry = index.setdefault(symbol, {"files": set(), "modules": set()})
            entry["files"].add(str(record.path))
            entry["modules"].add(record.module_name)
    return index


def discover_by_import_popularity(
    file_records: Sequence[FileRecord],
    local_declared_names: Set[str],
    import_index: Dict[str, Dict[str, Set[str]]],
    min_files: int = 5,
    min_modules: int = 2,
) -> List[RawCandidate]:
    candidates: List[RawCandidate] = []
    owner_by_name: Dict[str, FileRecord] = {}
    for record in file_records:
        if record.suffix not in SUPPORTED_SUFFIXES:
            continue
        for declaration in extract_declarations(record.text):
            owner_by_name.setdefault(declaration.name, record)

    for symbol, payload in import_index.items():
        if symbol not in local_declared_names:
            continue
        total_files = len(payload["files"])
        total_modules = len(payload["modules"])
        if total_files < min_files or total_modules < min_modules:
            continue
        owner = owner_by_name.get(symbol)
        if owner is None:
            continue
        name_tokens = split_identifier(symbol)
        path_tokens = collect_path_tokens(owner.path, owner.root)
        if not is_middleware_candidate(name_tokens, path_tokens, set(), owner.text):
            continue
        if any(token in UI_COMPONENT_HINTS for token in name_tokens) and total_files < 12:
            continue
        candidates.append(
            RawCandidate(
                name=symbol,
                path=owner.path,
                root=owner.root,
                path_tokens=path_tokens,
                platform=owner.platform or "",
                oss_hits=set(),
                score=max(4, total_files // 3 + total_modules),
                canonical_name=canonicalize_candidate_name(symbol),
                strong_signal=total_modules >= 3,
            )
        )
    return candidates


def detect_singleton_classes(file_records: Sequence[FileRecord]) -> Set[str]:
    singleton_names: Set[str] = set()
    for record in file_records:
        for declaration in extract_declarations(record.text):
            context = declaration.context_text
            if any(pattern.search(context) for pattern in SINGLETON_PATTERNS):
                singleton_names.add(declaration.name)
    return singleton_names


def discover_base_classes(
    file_records: Sequence[FileRecord],
    local_declared_names: Set[str],
    min_inheritors: int = 3,
    min_inheritor_modules: int = 2,
) -> List[RawCandidate]:
    base_to_children: Dict[str, Set[str]] = {}
    base_to_modules: Dict[str, Set[str]] = {}
    declaration_owners: Dict[str, Tuple[Path, Path]] = {}

    for record in file_records:
        for declaration in extract_declarations(record.text):
            declaration_owners.setdefault(declaration.name, (record.path, record.root))
        for pattern in INHERITANCE_PATTERNS:
            for child, base_name in pattern.findall(record.text):
                if base_name not in local_declared_names or child == base_name:
                    continue
                base_to_children.setdefault(base_name, set()).add(child)
                base_to_modules.setdefault(base_name, set()).add(record.module_name)

    candidates: List[RawCandidate] = []
    for base_name, children in base_to_children.items():
        total_inheritors = len(children)
        total_modules = len(base_to_modules.get(base_name, set()))
        if total_inheritors < min_inheritors or total_modules < min_inheritor_modules:
            continue
        owner_info = declaration_owners.get(base_name)
        if owner_info is None:
            continue
        owner_path, owner_root = owner_info
        path_tokens = collect_path_tokens(owner_path, owner_root)
        name_tokens = split_identifier(base_name)
        if any(token in UI_COMPONENT_HINTS for token in name_tokens) and not any(
            token in DESIGN_FOLLOW_HINTS for token in name_tokens
        ):
            if total_inheritors < 8:
                continue
        score = max(5, total_modules + total_inheritors // 2)
        candidates.append(
            RawCandidate(
                name=base_name,
                path=owner_path,
                root=owner_root,
                path_tokens=path_tokens,
                platform=infer_platform(owner_path, owner_path.suffix) or "",
                oss_hits=set(),
                score=score,
                canonical_name=canonicalize_candidate_name(base_name),
                strong_signal=True,
            )
        )
    return candidates


def collect_local_declaration_names(file_records: Sequence[FileRecord]) -> Set[str]:
    names: Set[str] = set()
    for record in file_records:
        if record.suffix not in SUPPORTED_SUFFIXES:
            continue
        for declaration in extract_declarations(record.text):
            names.add(declaration.name)
            names.add(canonicalize_candidate_name(declaration.name))
    return names


def collect_raw_candidates(
    file_records: Sequence[FileRecord],
    signals: Dict[str, Dict[str, Sequence[str]]],
    min_score: int,
) -> List[RawCandidate]:
    raw_candidates: List[RawCandidate] = []
    local_declared_names = collect_local_declaration_names(file_records)
    singleton_names = detect_singleton_classes(file_records)
    import_index = build_import_popularity_index(file_records)

    for record in file_records:
        raw_candidates.extend(extract_doc_candidates(record, local_declared_names))
        if record.suffix not in SUPPORTED_SUFFIXES:
            continue
        imports = extract_imports(record.text, record.suffix)
        oss_hits = match_oss_libraries(record.text, imports, signals)
        declarations = extract_declarations(record.text)
        path_tokens = collect_path_tokens(record.path, record.root)
        for decl_info in declarations:
            name_tokens = split_identifier(decl_info.name)
            if not name_tokens:
                continue
            is_singleton = decl_info.name in singleton_names
            if not is_middleware_candidate(name_tokens, path_tokens, oss_hits, decl_info.context_text) and not is_singleton:
                continue
            score = score_candidate(
                decl_info.name,
                name_tokens,
                path_tokens,
                oss_hits,
                decl_info.context_text,
                decl_info.annotations,
            )
            if is_singleton:
                score += 3
            if score < min_score:
                continue
            raw_candidates.append(
                RawCandidate(
                    name=decl_info.name,
                    path=record.path,
                    root=record.root,
                    path_tokens=path_tokens,
                    platform=record.platform or "",
                    oss_hits=set(oss_hits),
                    score=score,
                    canonical_name=canonicalize_candidate_name(decl_info.name),
                    strong_signal=has_design_signal(decl_info.context_text, name_tokens, path_tokens) or is_singleton,
                )
            )

    raw_candidates.extend(discover_by_import_popularity(file_records, local_declared_names, import_index))
    raw_candidates.extend(discover_base_classes(file_records, local_declared_names))
    return raw_candidates


def build_reference_index(file_records: Sequence[FileRecord]) -> Dict[str, Set[Path]]:
    index: Dict[str, Set[Path]] = {}
    for record in file_records:
        for symbol in record.reference_symbols:
            index.setdefault(symbol, set()).add(record.path)
    return index


def count_references(
    candidate_names: Sequence[str],
    owner_paths: Set[Path],
    owner_modules: Set[str],
    file_records: Sequence[FileRecord],
    reference_index: Mapping[str, Set[Path]],
) -> Tuple[int, int, int, int]:
    record_by_path = {record.path: record for record in file_records}
    matched_paths: Set[Path] = set()
    cjk_names = [name for name in candidate_names if contains_cjk(name)]

    for name in candidate_names:
        if contains_cjk(name):
            continue
        matched_paths.update(reference_index.get(name, set()))

    if cjk_names:
        patterns = [compile_reference_pattern(name) for name in cjk_names]
        for record in file_records:
            if record.path in matched_paths:
                continue
            if any(pattern.search(record.text) for pattern in patterns):
                matched_paths.add(record.path)

    code_files: Set[Path] = set()
    modules: Set[str] = set()
    cross_modules: Set[str] = set()
    docs: Set[Path] = set()

    for path in matched_paths:
        if path in owner_paths:
            continue
        record = record_by_path.get(path)
        if record is None:
            continue
        if record.is_doc:
            docs.add(record.path)
            continue
        if record.suffix in SUPPORTED_SUFFIXES:
            code_files.add(record.path)
            modules.add(record.module_name)
            if record.module_name not in owner_modules:
                cross_modules.add(record.module_name)

    return len(code_files), len(modules), len(cross_modules), len(docs)


def is_high_confidence_entry(
    name_tokens: Sequence[str],
    path_tokens: Sequence[str],
    category: str,
    strong_signal: bool,
) -> bool:
    if strong_signal:
        return True
    token_set = set(name_tokens) | set(path_tokens)
    if category in {"标准", "最佳实践"} and token_set & DESIGN_FOLLOW_HINTS:
        return True
    return bool(token_set & {"router", "gateway", "bridge", "sdk", "middleware", "interceptor"})


def merge_candidates(
    raw_candidates: Sequence[RawCandidate],
    file_records: Sequence[FileRecord],
    signals: Dict[str, Dict[str, Sequence[str]]],
    reference_index: Mapping[str, Set[Path]],
    min_ref_files: int,
    min_ref_modules: int,
    min_ref_docs: int,
    banned_identifiers: Set[str],
) -> List[Candidate]:
    grouped: Dict[str, List[RawCandidate]] = {}
    for candidate in raw_candidates:
        group_key = (candidate.canonical_name or candidate.name).lower()
        grouped.setdefault(group_key, []).append(candidate)

    merged: List[Candidate] = []
    for group in grouped.values():
        sample = group[0]
        owner_paths = {item.path for item in group}
        owner_modules = {
            infer_module_name(item.path, item.root)
            for item in group
            if item.source_kind == "code"
        }
        owner_doc_count = len({item.path for item in group if item.source_kind == "doc"})
        all_path_tokens: List[str] = []
        all_platforms: Set[str] = set()
        all_oss_hits: Set[str] = set()
        category_hint = ""
        candidate_names: Set[str] = set()
        strong_signal = False

        for item in group:
            all_path_tokens.extend(item.path_tokens)
            if item.platform:
                all_platforms.add(item.platform)
            all_oss_hits.update(item.oss_hits)
            if item.category_hint and not category_hint:
                category_hint = item.category_hint
            candidate_names.add(item.name)
            if item.canonical_name:
                candidate_names.add(item.canonical_name)
            strong_signal = strong_signal or item.strong_signal

        if any(name in banned_identifiers for name in candidate_names):
            continue

        ref_files, ref_modules, cross_modules, ref_docs = count_references(
            sorted(candidate_names),
            owner_paths,
            owner_modules,
            file_records,
            reference_index,
        )
        total_doc_refs = ref_docs + owner_doc_count
        canonical_name = sample.canonical_name or sample.name
        name_tokens = split_identifier(canonical_name)
        category = category_hint or classify_candidate(name_tokens, all_path_tokens)
        lowered_canonical = canonical_name.lower()
        high_confidence_entry = is_high_confidence_entry(name_tokens, all_path_tokens, category, strong_signal)

        if canonical_name in GENERIC_NOISE_NAMES:
            continue
        if lowered_canonical.startswith("t") and canonical_name not in EXACT_DESIGN_NAMES:
            if "dependency" in name_tokens or ref_files < 12:
                continue

        is_generic_standard = (
            category == "标准"
            and (
                lowered_canonical.endswith("config")
                or lowered_canonical.endswith("protocol")
                or lowered_canonical == "builder"
                or ("config" in name_tokens and len(name_tokens) <= 4)
                or lowered_canonical.endswith("configinfo")
            )
        )
        if is_generic_standard and not strong_signal and total_doc_refs < 2:
            continue

        if category in {"标准", "最佳实践"}:
            if total_doc_refs < min_ref_docs and not strong_signal and (
                ref_files < min_ref_files or ref_modules < min_ref_modules
            ):
                continue
            if category == "标准" and owner_doc_count == 0 and total_doc_refs < 2 and cross_modules < 1 and not strong_signal:
                continue
        else:
            strong_keep = strong_signal and (
                total_doc_refs >= 1
                or ref_files >= 5
                or (high_confidence_entry and ref_files >= 2)
                or (canonical_name in EXACT_DESIGN_NAMES and ref_files >= 2)
            )
            if (ref_files < min_ref_files or ref_modules < min_ref_modules or cross_modules < 1) and not strong_keep:
                continue
            if (
                cross_modules < 1
                and total_doc_refs == 0
                and not high_confidence_entry
                and canonical_name not in EXACT_DESIGN_NAMES
                and ref_files < 8
            ):
                continue

        keywords = build_keywords(
            canonical_name,
            name_tokens,
            all_path_tokens,
            sorted(all_platforms),
            sorted(all_oss_hits),
            signals,
            category,
        )
        merged.append(
            Candidate(
                name=canonical_name,
                category=category,
                score=max(item.score for item in group),
                keywords=keywords,
                possible_oss_wrapper=bool(all_oss_hits),
                oss_hits=all_oss_hits,
                platforms=all_platforms,
                reference_files=ref_files,
                reference_modules=ref_modules,
                cross_module_references=cross_modules,
                reference_docs=total_doc_refs,
                strong_signal=strong_signal,
                primary_path=sample.path if sample.source_kind == "code" else None,
            )
        )

    return sorted(
        merged,
        key=lambda item: (
            -item.cross_module_references,
            -item.reference_modules,
            -item.reference_files,
            -item.reference_docs,
            -item.score,
            item.name.lower(),
        ),
    )


def as_payload(candidates: Sequence[Candidate], max_results: int, include_path: bool = False) -> List[Dict[str, object]]:
    payload: List[Dict[str, object]] = []
    for candidate in candidates[:max_results]:
        wrapper_name = candidate.name
        if candidate.possible_oss_wrapper:
            wrapper_name = f"{wrapper_name}（疑似开源库封装）"
        item: Dict[str, object] = {
            "自定义封装": wrapper_name,
            "类型": candidate.category,
            "平台": "/".join(sorted(candidate.platforms)),
            "代码引用文件数": candidate.reference_files,
            "引用模块数": candidate.reference_modules,
            "跨模块引用数": candidate.cross_module_references,
            "文档引用数": candidate.reference_docs,
            "扩展关键字": ", ".join(candidate.keywords),
        }
        if include_path and candidate.primary_path is not None:
            item["声明文件"] = str(candidate.primary_path)
        payload.append(item)
    return payload


def render_markdown_table(payload: Sequence[Dict[str, object]]) -> str:
    if not payload:
        return "| 自定义封装 | 类型 | 平台 | 代码引用文件数 | 引用模块数 | 跨模块引用数 | 文档引用数 | 扩展关键字 |\n| --- | --- | --- | --- | --- | --- | --- | --- |"
    headers = ["自定义封装", "类型", "平台", "代码引用文件数", "引用模块数", "跨模块引用数", "文档引用数", "扩展关键字"]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for item in payload:
        row = [str(item.get(header, "")).replace("\n", " ") for header in headers]
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _term_width() -> int:
    try:
        return os.get_terminal_size().columns
    except OSError:
        return 120


def _display_width(text: str) -> int:
    width = 0
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff" or "\u3000" <= ch <= "\u303f" or "\uff00" <= ch <= "\uffef":
            width += 2
        else:
            width += 1
    return width


def _pad(text: str, width: int) -> str:
    actual = _display_width(text)
    return text + " " * max(0, width - actual)


def _truncate(text: str, max_width: int) -> str:
    if _display_width(text) <= max_width:
        return text
    width = 0
    for i, ch in enumerate(text):
        cw = 2 if ("\u4e00" <= ch <= "\u9fff" or "\u3000" <= ch <= "\u303f" or "\uff00" <= ch <= "\uffef") else 1
        if width + cw > max_width - 3:
            return text[:i] + "..."
        width += cw
    return text


def render_pretty_table(payload: Sequence[Dict[str, object]]) -> str:
    if not payload:
        return "(no results)"

    col_defs = [
        ("#", None, 4, 4, True),
        ("自定义封装", "自定义封装", 12, 40, False),
        ("类型", "类型", 8, 10, False),
        ("平台", "平台", 10, 16, False),
        ("引用", "代码引用文件数", 4, 6, True),
        ("模块", "引用模块数", 4, 6, True),
        ("跨模块", "跨模块引用数", 6, 8, True),
        ("文档", "文档引用数", 4, 6, True),
        ("扩展关键字", "扩展关键字", 20, 80, False),
    ]

    col_widths: List[int] = []
    for header, key, min_w, max_w, _ in col_defs:
        width = _display_width(header)
        if key:
            for item in payload:
                width = max(width, _display_width(str(item.get(key, ""))))
        col_widths.append(max(min_w, min(width, max_w)))

    total_width = sum(col_widths) + 3 * len(col_widths) + 1
    term_width = _term_width()
    if total_width > term_width:
        overflow = total_width - term_width
        col_widths[-1] = max(16, col_widths[-1] - overflow)

    sep = "+" + "+".join("-" * (width + 2) for width in col_widths) + "+"
    header_cells: List[str] = []
    for i, (header, _, _, _, align_right) in enumerate(col_defs):
        width = col_widths[i]
        if align_right:
            cell = " " * max(0, width - _display_width(header)) + header
        else:
            cell = _pad(header, width)
        header_cells.append(f" {cell} ")
    header_line = "|" + "|".join(header_cells) + "|"

    lines = [sep, header_line, sep]
    for row_idx, item in enumerate(payload, start=1):
        cells: List[str] = []
        for i, (_, key, _, _, align_right) in enumerate(col_defs):
            width = col_widths[i]
            if key is None:
                value = str(row_idx)
            else:
                value = str(item.get(key, ""))
            value = _truncate(value, width)
            if align_right:
                cell = " " * max(0, width - _display_width(value)) + value
            else:
                cell = _pad(value, width)
            cells.append(f" {cell} ")
        lines.append("|" + "|".join(cells) + "|")
    lines.append(sep)
    return "\n".join(lines)


def render_markdown_list(payload: Sequence[Dict[str, object]]) -> str:
    lines: List[str] = []
    for item in payload:
        lines.append(f"- 自定义封装: {item['自定义封装']}")
        lines.append(f"  类型: {item['类型']}")
        lines.append(f"  平台: {item['平台']}")
        lines.append(f"  代码引用文件数: {item['代码引用文件数']}")
        lines.append(f"  引用模块数: {item['引用模块数']}")
        lines.append(f"  文档引用数: {item['文档引用数']}")
        lines.append(f"  扩展关键字: {item['扩展关键字']}")
    return "\n".join(lines)


def render_csv(payload: Sequence[Dict[str, object]]) -> str:
    headers = ["自定义封装", "类型", "平台", "代码引用文件数", "引用模块数", "跨模块引用数", "文档引用数", "扩展关键字"]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers)
    writer.writeheader()
    for item in payload:
        writer.writerow({header: item.get(header, "") for header in headers})
    return buffer.getvalue()


def default_markdown_output_path(roots: Sequence[Path]) -> Path:
    if len(roots) == 1:
        root = roots[0]
        base_dir = root if root.is_dir() else root.parent
        return base_dir / "acs-custom-middleware-report.md"
    return Path.cwd() / "acs-custom-middleware-report.md"


def write_markdown_report(output_path: Path, markdown: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown + "\n", encoding="utf-8")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan mobile repositories for reusable custom middleware referenced by multiple files or modules.",
    )
    parser.add_argument("roots", nargs="+", help="Repository root(s) or source directories to scan")
    parser.add_argument(
        "--format",
        choices=("table", "markdown", "list", "json", "csv"),
        default="table",
        help="Output format",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=80,
        help="Maximum number of candidates to emit",
    )
    parser.add_argument(
        "--min-score",
        type=int,
        default=2,
        help="Minimum heuristic score required to keep a declaration candidate",
    )
    parser.add_argument(
        "--min-ref-files",
        type=int,
        default=2,
        help="Minimum number of code files that must reference the candidate",
    )
    parser.add_argument(
        "--min-ref-modules",
        type=int,
        default=1,
        help="Minimum number of modules that must reference the candidate",
    )
    parser.add_argument(
        "--min-ref-docs",
        type=int,
        default=1,
        help="Minimum number of document assets or mentions required for standards and best practices",
    )
    parser.add_argument(
        "--output-md",
        help="Markdown report output path. Defaults to <repo>/acs-custom-middleware-report.md for a single root.",
    )
    parser.add_argument(
        "--no-write-md",
        action="store_true",
        help="Do not write the Markdown report file automatically",
    )
    parser.add_argument(
        "--include-docs",
        action="store_true",
        help="Also scan Markdown and text documents. By default only code files and code comments are scanned.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    roots = [Path(root).resolve() for root in args.roots]
    missing = [str(root) for root in roots if not root.exists()]
    if missing:
        print("Missing path(s): " + ", ".join(missing), file=sys.stderr)
        return 1

    signals_path = Path(__file__).resolve().parent.parent / "references" / "oss_signals.json"
    signals = load_oss_signals(signals_path)
    file_records = collect_file_records(roots, include_docs=args.include_docs)
    reference_index = build_reference_index(file_records)
    local_declared_names = collect_local_declaration_names(file_records)
    banned_identifiers = collect_banned_identifiers(file_records, local_declared_names)
    raw_candidates = collect_raw_candidates(file_records, signals, args.min_score)
    candidates = merge_candidates(
        raw_candidates,
        file_records,
        signals,
        reference_index,
        args.min_ref_files,
        args.min_ref_modules,
        args.min_ref_docs,
        banned_identifiers,
    )

    include_path = args.format == "json"
    payload = as_payload(candidates, args.max_results, include_path=include_path)
    markdown_report = render_markdown_table(as_payload(candidates, args.max_results))

    if args.format == "json":
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    elif args.format == "csv":
        sys.stdout.write(render_csv(payload))
    elif args.format == "list":
        print(render_markdown_list(payload))
    elif args.format == "markdown":
        print(markdown_report)
    else:
        print(render_pretty_table(payload))

    if not args.no_write_md:
        output_path = (
            Path(args.output_md).expanduser().resolve()
            if args.output_md
            else default_markdown_output_path(roots)
        )
        write_markdown_report(output_path, markdown_report)
        if args.format not in ("markdown", "json", "csv"):
            print(f"\n[report] {output_path}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
