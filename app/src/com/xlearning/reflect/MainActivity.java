package com.xlearning.reflect;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Reflect 复盘 —— 原生壳。
 * WebView 承载 assets 里的复盘 UI；通过 AndroidBridge 暴露保存文件 / 分享 / toast。
 */
public class MainActivity extends Activity {

    /** 用虚拟 https 域名承载 assets，保证 WebView 里 localStorage 有稳定 origin。 */
    private static final String ASSET_HOST = "reflect.local";
    private static final String BASE_URL = "https://" + ASSET_HOST + "/index.html";

    private WebView webView;
    /** JS 侧主动消费掉的返回事件（例如关闭了某个弹层）。 */
    private boolean backConsumed = false;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("css", "text/css");
        MIME.put("js", "application/javascript");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("woff2", "font/woff2");
        MIME.put("txt", "text/plain");
        MIME.put("md", "text/markdown");
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFF0E1116);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && ASSET_HOST.equals(uri.getHost())) {
                    WebResourceResponse resp = serveAsset(uri.getPath());
                    if (resp != null) return resp;
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && ASSET_HOST.equals(uri.getHost())) return false;
                // 外部链接交给系统浏览器
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BASE_URL);
        }
    }

    /** 从 assets 读取文件并包装成 WebResourceResponse。 */
    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/")) path = "/index.html";
        String rel = path.startsWith("/") ? path.substring(1) : path;
        if (rel.contains("..")) return null;
        try {
            InputStream in = getAssets().open(rel);
            String ext = "";
            int dot = rel.lastIndexOf('.');
            if (dot >= 0) ext = rel.substring(dot + 1).toLowerCase();
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            WebResourceResponse resp = new WebResourceResponse(mime, "utf-8", in);
            resp.setResponseHeaders(headers);
            return resp;
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    /** 优先让页面自己消费返回（关闭弹层 / 回上一屏），否则网页后退，再否则退出。 */
    @Override
    public void onBackPressed() {
        backConsumed = false;
        webView.evaluateJavascript(
                "(function(){try{return window.Reflect&&Reflect.ui&&Reflect.ui.onBack?Reflect.ui.onBack():false}"
                        + "catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value) && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            finish();
                        }
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** 暴露给 JS 的原生能力。 */
    public class Bridge {

        /** 保存文本文件：返回 JSON 字符串 {"ok":true,"path":"..."} 或 {"ok":false,"error":"..."} */
        @JavascriptInterface
        public String saveFile(String filename, String content) {
            try {
                String safe = (filename == null || filename.trim().isEmpty())
                        ? "reflect-export.md" : filename.trim();
                if (!safe.contains(".")) safe = safe + ".md";
                byte[] bytes = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
                String path;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContentResolver();
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "text/markdown");
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Reflect");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri item = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (item == null) return "{\"ok\":false,\"error\":\"无法创建文件\"}";
                    OutputStream os = cr.openOutputStream(item);
                    if (os == null) return "{\"ok\":false,\"error\":\"无法写入文件\"}";
                    os.write(bytes);
                    os.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    cr.update(item, cv, null, null);
                    path = "下载/Reflect/" + safe;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Reflect");
                    if (!dir.exists() && !dir.mkdirs()) return "{\"ok\":false,\"error\":\"无法创建目录\"}";
                    File f = new File(dir, safe);
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(bytes);
                    fos.close();
                    path = f.getAbsolutePath();
                }
                return "{\"ok\":true,\"path\":\"" + jsonEscape(path) + "\"}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":\"" + jsonEscape(String.valueOf(e.getMessage())) + "\"}";
            }
        }

        /** 调起系统分享。 */
        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_SUBJECT, "Reflect 复盘");
                        i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                        startActivity(Intent.createChooser(i, "分享复盘"));
                    } catch (Exception ignored) {
                        toast("没有找到可用的分享应用");
                    }
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            if (msg == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return "1.0.0";
        }
    }

    private static String jsonEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}
