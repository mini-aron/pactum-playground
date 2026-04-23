# Pactum Playground

Vite 기반 데모 앱으로, 로컬 모노레포 [`C:\Users\이아론\Desktop\project\Pactum`](C:\Users\이아론\Desktop\project\Pactum) 의 `@pactum/pactum_core` 와 `@pactum/pactum_react` 를 직접 참조합니다.

## What it shows

- `ContractViewer` 렌더링
- `createDocument`, `createField` 로 생성한 샘플 계약서
- `source` / `mirror` shared field 동기화
- `fill`, `builder`, `readonly` 모드 전환

## Run

```bash
pnpm dev
```

## Notes

- Vite alias와 TypeScript path를 이용해 외부 `Pactum` 소스를 직접 바라봅니다.
- PDF worker는 `public/pdf.worker.min.mjs` 로 고정 복사해 사용합니다.
