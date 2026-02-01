# AGENTS.md

AI 에이전트를 위한 커밋 가이드라인.

## Commit Guidelines

### Commit Message Format

이 프로젝트는 **Semantic Commit** 스타일을 사용합니다:

```
type(scope): description

- bullet point details
- more details

Co-authored-by: Claude Opus 4.5 <noreply@anthropic.com>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 기능 변경 없는 코드 개선 |
| `docs` | 문서 변경 |
| `chore` | 빌드, 설정, 의존성 등 |
| `style` | 포맷팅 |
| `perf` | 성능 개선 |

### Scopes

| Scope | Description |
|-------|-------------|
| `scene` | 3D 씬, 조명, 카메라, 포스트 프로세싱 |
| `geometry` | 프로시저럴 지오메트리 생성 |
| `materials` | PBR 재질 |
| `controls` | FPS 컨트롤, UI 패널 |
| `ui` | 오버레이, 디버그 UI |
| `assets` | 텍스처, 모델 등 에셋 |

### Commit Splitting Rules

1. **모듈별 분리**: geometry, lighting, UI 등 다른 영역은 다른 커밋
2. **3파일 이상**: 반드시 분리 검토
3. **의존성 순서**: 기반 모듈 먼저 커밋

### Example Commits

```
feat(scene): add procedural FBM noise-based structure generation
feat(materials): add teal and gold PBR materials with textures
feat(controls): add leva control panel for atmosphere settings
fix(scene): adjust lighting for brighter daytime atmosphere
chore: add leva dependency for UI controls
```
