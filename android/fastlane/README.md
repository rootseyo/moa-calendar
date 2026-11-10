fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Android

### android test

```sh
[bundle exec] fastlane android test
```

단위 테스트(Unit Tests) 실행

### android lint

```sh
[bundle exec] fastlane android lint
```

정적 분석(Lint) 실행

### android build_debug

```sh
[bundle exec] fastlane android build_debug
```

개발용 디버그 APK 빌드

### android build

```sh
[bundle exec] fastlane android build
```

릴리즈 AAB(Android App Bundle) 및 APK 빌드

### android beta

```sh
[bundle exec] fastlane android beta
```

Google Play Console 내부 테스트(Internal Test) 트랙에 배포

### android release

```sh
[bundle exec] fastlane android release
```

Google Play Console 프로덕션(Production) 정식 배포

### android production

```sh
[bundle exec] fastlane android production
```

검증된 릴리스 번들을 운영 트랙에 업로드

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
