/**
 * Guards for the Android packaging and release configuration.
 *
 * These are facts that are easy to break silently and expensive to discover on
 * a device or, worse, in a distributed APK: the permission set, the backup and
 * cleartext posture, what may be packaged, and the signing gate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const manifest = read("../../android/app/src/main/AndroidManifest.xml");
const appGradle = read("../../android/app/build.gradle");
const capacitorConfig = read("../../capacitor.config.ts");
const viteMobile = read("../../vite.mobile.config.ts");
const workflow = read("../../.github/workflows/android.yml");
const gitignore = read("../../.gitignore");
const androidGitignore = read("../../android/.gitignore");

const APP_ID = "io.github.harshi79.origen";

describe("application identity", () => {
  it("keeps one application id across Gradle, the manifest and the Capacitor config", () => {
    expect(appGradle).toContain(`namespace = "${APP_ID}"`);
    expect(appGradle).toContain(`applicationId "${APP_ID}"`);
    expect(capacitorConfig).toContain(`appId: "${APP_ID}"`);
    // The manifest's FileProvider authority is derived from the same id.
    expect(manifest).toContain('android:authorities="${applicationId}.fileprovider"');
    expect(read("../../android/app/src/main/res/values/strings.xml")).toContain(
      `<string name="package_name">${APP_ID}</string>`,
    );
  });

  it("derives versionName from package.json so the APK and the app agree", () => {
    expect(appGradle).toContain("packageJson.version");
    expect(appGradle).toContain("major * 10000 + minor * 100 + patch");
  });
});

describe("permissions and privacy posture", () => {
  it("requests network access and nothing else", () => {
    const requested = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"\s*\/>/g)].map((m) => m[1]);
    expect(requested.sort()).toEqual(["android.permission.ACCESS_NETWORK_STATE", "android.permission.INTERNET"]);
  });

  it("actively strips broad storage permissions a dependency might merge in", () => {
    for (const permission of ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE"]) {
      expect(manifest).toContain(`android.permission.${permission}" tools:node="remove"`);
    }
  });

  it("disables backup, device transfer and cleartext traffic", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(read("../../android/app/src/main/res/xml/data_extraction_rules.xml")).toContain("<device-transfer>");
  });

  it("exports only the launcher activity and keeps the FileProvider private and scoped", () => {
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(manifest.match(/android:exported="true"/g)).toHaveLength(1);
    expect(manifest).toContain('android:name="androidx.core.content.FileProvider"');
    expect(manifest).toContain('android:exported="false"');
    expect(read("../../android/app/src/main/res/xml/file_paths.xml")).toContain('<cache-path name="exports" path="exports/" />');
  });
});

describe("session and configuration changes", () => {
  it("handles fontScale itself, so a font change is not a relaunch", () => {
    // Without fontScale the activity is recreated, the WebView reloads and the
    // app boots from scratch: the session is lost and the launch prompt returns
    // even though the process never died.
    const configChanges = manifest.match(/android:configChanges="([^"]+)"/)![1].split("|");
    expect(configChanges).toContain("fontScale");
    expect(configChanges).toContain("uiMode");
    expect(configChanges).toContain("orientation");
  });

  it("resizes for the keyboard rather than panning over it", () => {
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
    expect(manifest).toContain('android:launchMode="singleTask"');
  });
});

describe("what may be packaged", () => {
  it("builds the mobile bundle without source maps", () => {
    expect(viteMobile).toContain("sourcemap: false");
  });

  it("fails CI if sources, maps, tests, env files or keys are packaged", () => {
    expect(workflow).toContain("Assert the packaged payload holds no sources or secrets");
    for (const pattern of ["*.map", "*.ts", "*.test.*", "*.spec.*", ".env*", "*.jks", "*.keystore", "google-services.json"]) {
      expect(workflow).toContain(pattern);
    }
    expect(workflow).toContain("sourceMappingURL");
  });

  it("never tracks signing material", () => {
    expect(gitignore).toContain("android/keystore.properties");
    expect(gitignore).toContain("*.jks");
    expect(gitignore).toContain("*.keystore");
    expect(androidGitignore).toContain("local.properties");
    expect(androidGitignore).toContain("app/src/main/assets/public");
    // Only the placeholder is committed.
    expect(read("../../android/keystore.properties.example")).toContain("storePassword=change-me");
  });
});

describe("release build and signing", () => {
  it("signs the release build only when a complete credential set is present", () => {
    expect(appGradle).toContain("def hasReleaseSigning = releaseStorePath && releaseStorePassword && releaseKeyAlias && releaseKeyPassword");
    expect(appGradle).toContain("if (hasReleaseSigning) {\n                signingConfig signingConfigs.release");
    // Credentials are read from a git-ignored file or the environment, never hardcoded.
    expect(appGradle).toContain("keystoreProperties.getProperty(key) ?: System.getenv(envName)");
  });

  it("never turns verbose bridge logging on in a release build", () => {
    // "debug" resolves to `loggingEnabled = isDebug`; "production" would force
    // it ON in release and write plugin arguments — clipboard and export
    // contents — to logcat.
    expect(capacitorConfig).toContain('loggingBehavior: "debug"');
    expect(capacitorConfig).not.toContain('loggingBehavior: "production"');
  });

  it("builds and verifies the release artifacts in CI, and blocks a debug-signed release", () => {
    expect(workflow).toContain("./gradlew assembleRelease bundleRelease");
    expect(workflow).toContain("apksigner");
    expect(workflow).toContain("--print-certs");
    expect(workflow).toContain("Android Debug");
    expect(workflow).toContain("origen-release-apk");
    // The debug artifact stays available for testing.
    expect(workflow).toContain("origen-debug-apk");
  });

  it("reports a missing signing configuration instead of faking one", () => {
    expect(workflow).toContain("Release signing is not configured");
    expect(workflow).toContain("docs/ANDROID.md#release-signing");
    expect(workflow).not.toContain("keytool -genkeypair");
  });

  it("uploads a freshly built final APK with the requested download names", () => {
    expect(workflow).toContain("name: ORIGENFINAL");
    expect(workflow).toContain("ORIGEN FINAL APK.apk");
    expect(workflow).toContain("io.github.harshi79.origen");
    expect(workflow).toContain("ORIGENFINAL contains a debug APK, not a signed release APK");
  });
});
