# AGENTS.md

AI 에이전트를 위한 프로젝트 컨텍스트 및 커밋 가이드라인.

## Project Context

**Endfield Industry Editor**는 Arknights: Endfield의 공장 자동화 시스템을 위한 생산 체인 계획 도구입니다.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Material** | 게임 내 아이템 (원석, 분말, 부품 등) |
| **Recipe** | 입력 → 출력 변환 규칙 (craft time, power 포함) |
| **Facility** | 레시피를 실행하는 건물 (input/output slots 보유) |
| **Belt** | 시설 간 자원 이동 (30 items/min 용량 제한) |
| **Blueprint** | 노드(시설/자원) + 엣지(벨트) 구성의 공장 설계도 |

### Key Constraints

- Belt capacity: **30 items/min**
- Facility slots: 시설별 input/output 슬롯 수 제한
- Cyclic production: 일부 레시피는 순환 의존성 (buckflower ↔ seed)

## Architecture

```
src/
├── components/          # React 컴포넌트
│   ├── nodes/          # FacilityNode, MaterialNode
│   └── ui/             # Sidebar, ReportViewer
├── data/               # 게임 데이터 (materials, recipes, facilities)
├── store/              # Zustand store (editorStore.ts)
├── utils/              # 핵심 알고리즘
│   ├── graph-algorithms.ts   # Tarjan SCC, topological sort
│   ├── linear-solver.ts      # Gaussian elimination
│   ├── production-solver.ts  # 생산 체인 계산
│   ├── blueprintGenerator.ts # 청사진 생성
│   ├── flowCalculator.ts     # 흐름 시뮬레이션
│   └── optimizer.ts          # 자동 최적화
└── types/              # TypeScript 타입
```

### Algorithm Flow

```
1. User Input (target item, rate)
       ↓
2. Production Solver
   - Build bipartite graph (items ↔ recipes)
   - Detect cycles with Tarjan SCC
   - Solve cycle ratios with Gaussian elimination
   - Topological sort for processing order
       ↓
3. Blueprint Generator
   - Split materials by belt capacity (30/min)
   - Create facility nodes with slots
   - Route edges respecting slot limits
       ↓
4. Flow Simulation
   - Calculate actual throughput
   - Detect bottlenecks
   - Report efficiency
```

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
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정 등 기타 |
| `style` | 포맷팅, 세미콜론 등 |
| `perf` | 성능 개선 |

### Scopes

| Scope | Files |
|-------|-------|
| `solver` | production-solver.ts, graph-algorithms.ts, linear-solver.ts |
| `blueprint` | blueprintGenerator.ts |
| `flow` | flowCalculator.ts |
| `optimizer` | optimizer.ts |
| `store` | editorStore.ts |
| `ui` | components/ |
| `data` | data/ |
| `core` | 여러 핵심 모듈에 걸친 변경 |

### Commit Splitting Rules

1. **모듈별 분리**: 다른 디렉토리/모듈은 다른 커밋
2. **테스트 동봉**: 구현 + 테스트는 같은 커밋
3. **3파일 이상**: 반드시 분리 검토
4. **의존성 순서**: 기반 모듈 먼저 커밋

### Example Commits (Recent)

```
feat(solver): add graph algorithms for bipartite production analysis
feat(solver): implement production solver with SCC cycle detection
feat(solver): integrate new solver into production calculator
feat(blueprint): improve belt distribution and facility connections
feat(flow): add graph validation and cyclic flow simulation
feat(store): enhance editor state for optimization and cycles
feat(ui): update nodes and components for new solver
feat(optimizer): add production chain optimizer
```

## Code Patterns

### Type Safety

```typescript
// GOOD: Explicit null checks
const recipe = getRecipe(recipeId);
if (!recipe) return;

// BAD: Type assertions
const recipe = getRecipe(recipeId) as Recipe; // Never do this
```

### Belt Capacity

```typescript
const BELT_CAPACITY = 30;

// Split materials by belt capacity
const beltsNeeded = Math.ceil(rate / BELT_CAPACITY);
for (let b = 0; b < beltsNeeded; b++) {
  const beltRate = Math.min(BELT_CAPACITY, rate - b * BELT_CAPACITY);
  // ...
}
```

### Cycle Handling

```typescript
// Detect SCCs for cyclic production
const sccs = detectSCCs(graph);
for (const scc of sccs) {
  if (scc.isTrivial) {
    // Simple linear calculation
  } else {
    // Solve with Gaussian elimination
    solveCyclicSCC(scc, graph, facilityRequirements);
  }
}
```

## Testing

```bash
# Run production solver tests
npx tsx tests/production-solver.spec.ts

# Run blueprint tests
npx tsx tests/blueprint.spec.ts

# Build check
npm run build
```

### Test Scenarios

| Test | Description |
|------|-------------|
| SC Valley Battery | 복잡한 선형 체인 (10개 레시피) |
| Buck Capsule C | 순환 생산 (buckflower ↔ seed) |
| Multiple targets | 다중 목표 생산 |
| Belt distribution | 벨트 분배 정확성 |

## Feature Flags

```typescript
// src/utils/productionCalculator.ts
export let USE_NEW_SOLVER = true;  // New bipartite graph solver
export function setUseNewSolver(enabled: boolean): void {
  USE_NEW_SOLVER = enabled;
}
```
