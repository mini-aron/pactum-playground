import {
  createDocument,
  getResolvedValues,
  removeField,
  updateField,
  type ContractDocument,
  type ContractField,
  type ContractFieldType,
  type ContractFieldValue,
  type SignatureInputMode,
} from '@pactum-labs/core'
import {
  ContractViewer,
  configurePdfWorker,
  type ContractViewerHandle,
  type ContractMode,
} from '@pactum-labs/react'
import { PDFDocument } from 'pdf-lib'
import {
  useEffect,
  useMemo,
  type RefObject,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import './App.css'

type TemplateDefinition = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly field: Omit<ContractField, 'id' | 'page'> & {
    readonly dateFormat?: string
  }
}

type ViewerCursorPosition = {
  readonly page: number
  readonly x: number
  readonly y: number
  readonly absoluteX: number
  readonly absoluteY: number
}

const MODE_COPY: Record<
  ContractMode,
  { readonly title: string; readonly note: string }
> = {
  fill: {
    title: '입력',
    note: '현재 계약서의 필드에 값을 입력하고 해석된 값을 확인합니다.',
  },
  sign: {
    title: '서명',
    note: '서명 필드와 서명 모드 동작을 확인합니다.',
  },
  builder: {
    title: '빌더',
    note: 'PDF 위에 필드를 만들고 위치와 속성을 조정합니다.',
  },
  readonly: {
    title: '읽기 전용',
    note: '편집 없이 최종 렌더링 상태를 확인합니다.',
  },
}

const FIELD_TYPE_LABELS: Record<ContractFieldType, string> = {
  text: '텍스트',
  date: '날짜',
  checkbox: '체크박스',
  signature: '서명',
  email: '이메일',
  phone: '전화번호',
  number: '숫자',
  textarea: '긴 텍스트',
}

const SIGNATURE_MODE_LABELS: Record<SignatureInputMode, string> = {
  all: '서명+스탬프',
  'sign-only': '서명만',
  'stamp-only': '스탬프만',
}

const SIGNATURE_MODES: readonly SignatureInputMode[] = ['all', 'sign-only', 'stamp-only']

const FIELD_TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'party-name',
    title: '계약자명',
    description: '계약자 이름을 입력하는 필드를 추가합니다.',
    field: {
      name: '계약자명',
      type: 'text',
      x: 0.12,
      y: 0.18,
      width: 0.28,
      height: 0.045,
      label: '계약자명',
      placeholder: '홍길동',
      textSize: 12,
      required: true,
    },
  },
  {
    id: 'signed-date',
    title: '계약일',
    description: '계약일을 입력하는 날짜 필드를 추가합니다.',
    field: {
      name: '계약일',
      type: 'date',
      x: 0.62,
      y: 0.18,
      width: 0.18,
      height: 0.045,
      label: '계약일',
      placeholder: 'yyyy.MM.dd',
      textSize: 12,
      dateFormat: 'yyyy.MM.dd',
    },
  },
  {
    id: 'amount',
    title: '계약금액',
    description: '숫자 입력용 계약금액 필드를 추가합니다.',
    field: {
      name: '계약금액',
      type: 'number',
      x: 0.12,
      y: 0.28,
      width: 0.22,
      height: 0.045,
      label: '계약금액',
      placeholder: '1000000',
      textSize: 12,
      required: true,
    },
  },
  {
    id: 'sign',
    title: '서명',
    description: '서명 입력 테스트용 필드를 추가합니다.',
    field: {
      name: '서명',
      type: 'signature',
      x: 0.62,
      y: 0.72,
      width: 0.22,
      height: 0.09,
      label: '서명',
      textSize: 12,
      required: true,
    },
  },
]

const ACCEPTED_FILE_TYPES = '.pdf,.json'
const DATE_FORMAT_PRESETS = ['yyyy.MM.dd', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yy.MM.dd']

configurePdfWorker('/pdf.worker.min.mjs')

export default function App(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewerSurfaceRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ContractViewerHandle>(null)
  const [mode, setMode] = useState<ContractMode>('fill')
  const [documentState, setDocumentState] = useState<ContractDocument | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<TemplateDefinition | null>(null)
  const [signatureMode, setSignatureMode] = useState<SignatureInputMode>('all')
  const [cursorPosition, setCursorPosition] = useState<ViewerCursorPosition | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('샘플 계약서를 불러오는 중입니다.')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    void loadSampleDocument()
      .then((doc) => {
        if (!alive) return
        setDocumentState(doc)
        setSelectedFieldId(doc.fields[0]?.id ?? null)
        setStatusMessage(
          '샘플 계약서가 준비되었습니다. 빌더 모드에서 필드를 배치하고 모드를 바꿔 동작을 확인하세요.',
        )
      })
      .catch((error: unknown) => {
        if (!alive) return
        setErrorMessage(toErrorMessage(error, '샘플 계약서를 불러오지 못했습니다.'))
        setStatusMessage('PDF 또는 Pactum JSON 파일을 올려 테스트를 시작하세요.')
      })
      .finally(() => {
        if (alive) {
          setIsLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [])

  const selectedField = useMemo(() => {
    return documentState?.fields.find((field) => field.id === selectedFieldId) ?? null
  }, [documentState, selectedFieldId])

  const resolvedValues = useMemo(() => {
    return documentState ? Object.entries(getResolvedValues(documentState)) : []
  }, [documentState])

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await importFile(file)
  }

  const onDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    await importFile(file)
  }

  const importFile = async (file: File) => {
    setIsImporting(true)
    setErrorMessage(null)
    setStatusMessage(`${file.name} 파일을 불러오는 중입니다...`)

    try {
      const nextDocument = await loadContractFromFile(file)
      setDocumentState(nextDocument)
      setSelectedFieldId(nextDocument.fields[0]?.id ?? null)
      setStatusMessage(`${file.name} 파일이 준비되었습니다. 렌더러와 필드 동작을 확인하세요.`)
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error, '계약서 파일을 불러오지 못했습니다.'))
      setStatusMessage('다른 PDF 또는 Pactum JSON 파일을 선택해 주세요.')
    } finally {
      setIsImporting(false)
    }
  }

  const onLoadSample = async () => {
    setIsImporting(true)
    setErrorMessage(null)
    setStatusMessage('샘플 계약서를 다시 불러오는 중입니다...')

    try {
      const nextDocument = await loadSampleDocument()
      setDocumentState(nextDocument)
      setSelectedFieldId(nextDocument.fields[0]?.id ?? null)
      setStatusMessage('샘플 계약서가 다시 준비되었습니다.')
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error, '샘플 계약서를 다시 불러오지 못했습니다.'))
    } finally {
      setIsImporting(false)
    }
  }

  const onExportJson = () => {
    if (!documentState) return

    const blob = new Blob([JSON.stringify(serializeDocument(documentState), null, 2)], {
      type: 'application/json',
    })
    const href = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = href
    anchor.download = `${slugify(documentState.title || 'contract')}.pactum.json`
    anchor.click()
    URL.revokeObjectURL(href)
    setStatusMessage('현재 문서 스냅샷을 Pactum JSON으로 내보냈습니다.')
  }

  const onArmTemplatePlacement = (template: TemplateDefinition) => {
    setPendingTemplate(template)
    setMode('builder')
    const placeholder = template.field.placeholder?.trim()
    const dateFormat =
      template.field.type === 'date' ? template.field.dateFormat?.trim() : undefined

    viewerRef.current?.beginDragCreate(template.field.type, {
      ...(placeholder ? { placeholder } : {}),
      ...(dateFormat ? { dateFormat } : {}),
    })
    setStatusMessage(
      `${template.title} 필드 추가가 준비되었습니다. 문서 위에서 드래그해 영역을 만드세요.`,
    )
  }

  const onCancelTemplatePlacement = () => {
    viewerRef.current?.cancelDragCreate()
    setPendingTemplate(null)
    setStatusMessage('필드 추가를 취소했습니다.')
  }

  const onDeleteField = () => {
    if (!documentState || !selectedField) return

    const nextDocument = removeField(documentState, selectedField.id)
    const nextSelectedFieldId = nextDocument.fields[0]?.id ?? null
    setDocumentState(nextDocument)
    setSelectedFieldId(nextSelectedFieldId)
    setStatusMessage(`${selectedField.name} 필드를 삭제했습니다.`)
  }

  const onFieldPatch = (patch: Partial<Omit<ContractField, 'id' | 'type'>>) => {
    if (!documentState || !selectedField) return
    const nextDocument = updateField(documentState, selectedField.id, patch)
    setDocumentState(nextDocument)
  }

  const onDateFormatChange = (dateFormat: string) => {
    onFieldPatch({ dateFormat: dateFormat.trim() || undefined } as Partial<
      Omit<ContractField, 'id' | 'type'>
    >)
  }

  const onSignatureModeChange = (nextSignatureMode: SignatureInputMode) => {
    onFieldPatch({ signatureMode: nextSignatureMode } as Partial<Omit<ContractField, 'id' | 'type'>>)
  }

  const onViewerDocumentChange = (nextDocument: ContractDocument) => {
    if (
      documentState &&
      pendingTemplate &&
      nextDocument.fields.length === documentState.fields.length + 1
    ) {
      const nextField = nextDocument.fields.find(
        (field) => !documentState.fields.some((current) => current.id === field.id),
      )

      if (nextField) {
        const fieldPatch = {
          name: pendingTemplate.field.name,
          label: pendingTemplate.field.label,
          placeholder: pendingTemplate.field.placeholder,
          required: pendingTemplate.field.required,
          ...(pendingTemplate.field.type === 'date' && pendingTemplate.field.dateFormat
            ? { dateFormat: pendingTemplate.field.dateFormat }
            : {}),
          ...(pendingTemplate.field.type === 'signature'
            ? { signatureMode }
            : {}),
        } as Partial<Omit<ContractField, 'id' | 'type'>>

        const enrichedDocument = updateField(nextDocument, nextField.id, fieldPatch)

        setDocumentState(enrichedDocument)
        setSelectedFieldId(nextField.id)
        setPendingTemplate(null)
        setStatusMessage(
          `${pendingTemplate.title} 필드를 만들었습니다.`,
        )
        return
      }
    }

    setDocumentState(nextDocument)
  }

  const getCursorPosition = (clientX: number, clientY: number): ViewerCursorPosition | null => {
    if (!viewerSurfaceRef.current || !documentState) return null

    const canvases = Array.from(viewerSurfaceRef.current.querySelectorAll('canvas'))
    for (const [index, canvas] of canvases.entries()) {
      const rect = canvas.getBoundingClientRect()
      const withinX = clientX >= rect.left && clientX <= rect.right
      const withinY = clientY >= rect.top && clientY <= rect.bottom
      if (!withinX || !withinY) continue

      const page = documentState.pages[index]
      if (!page) return null

      const x = clampUnit((clientX - rect.left) / rect.width)
      const y = clampUnit((clientY - rect.top) / rect.height)

      return {
        page: index,
        x,
        y,
        absoluteX: Math.round(x * page.width),
        absoluteY: Math.round(y * page.height),
      }
    }

    return null
  }

  const onViewerPointerMove = (clientX: number, clientY: number) => {
    setCursorPosition(getCursorPosition(clientX, clientY))
  }

  const onViewerPointerLeave = () => {
    setCursorPosition(null)
  }

  useEffect(() => {
    if (mode !== 'builder' && pendingTemplate) {
      viewerRef.current?.cancelDragCreate()
      setPendingTemplate(null)
    }
  }, [mode, pendingTemplate])

  return (
    <main className="app-shell">
      <PlaygroundPage
        inputRef={inputRef}
        mode={mode}
        onModeChange={setMode}
        signatureMode={signatureMode}
        onSignatureModePresetChange={setSignatureMode}
        documentState={documentState}
        dragActive={dragActive}
        setDragActive={setDragActive}
        isImporting={isImporting}
        isLoading={isLoading}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        onDocumentChange={onViewerDocumentChange}
        selectedFieldId={selectedFieldId}
        selectedField={selectedField}
        resolvedValues={resolvedValues}
        onFileChange={onFileChange}
        onDrop={onDrop}
        onLoadSample={onLoadSample}
        onExportJson={onExportJson}
        onDeleteField={onDeleteField}
        onFieldPatch={onFieldPatch}
        onDateFormatChange={onDateFormatChange}
        onSignatureModeChange={onSignatureModeChange}
        onSelectField={setSelectedFieldId}
        pendingTemplate={pendingTemplate}
        cursorPosition={cursorPosition}
        viewerSurfaceRef={viewerSurfaceRef}
        viewerRef={viewerRef}
        onArmTemplatePlacement={onArmTemplatePlacement}
        onCancelTemplatePlacement={onCancelTemplatePlacement}
        onViewerPointerMove={onViewerPointerMove}
        onViewerPointerLeave={onViewerPointerLeave}
      />
    </main>
  )
}

type PlaygroundPageProps = {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly mode: ContractMode
  readonly onModeChange: (mode: ContractMode) => void
  readonly signatureMode: SignatureInputMode
  readonly onSignatureModePresetChange: (mode: SignatureInputMode) => void
  readonly documentState: ContractDocument | null
  readonly dragActive: boolean
  readonly setDragActive: (active: boolean) => void
  readonly isImporting: boolean
  readonly isLoading: boolean
  readonly statusMessage: string
  readonly errorMessage: string | null
  readonly onDocumentChange: (document: ContractDocument) => void
  readonly selectedFieldId: string | null
  readonly selectedField: ContractField | null
  readonly resolvedValues: Array<[string, ContractFieldValue]>
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  readonly onDrop: (event: DragEvent<HTMLLabelElement>) => Promise<void>
  readonly onLoadSample: () => Promise<void>
  readonly onExportJson: () => void
  readonly onDeleteField: () => void
  readonly onFieldPatch: (patch: Partial<Omit<ContractField, 'id' | 'type'>>) => void
  readonly onDateFormatChange: (dateFormat: string) => void
  readonly onSignatureModeChange: (mode: SignatureInputMode) => void
  readonly onSelectField: (fieldId: string | null) => void
  readonly pendingTemplate: TemplateDefinition | null
  readonly cursorPosition: ViewerCursorPosition | null
  readonly viewerSurfaceRef: RefObject<HTMLDivElement | null>
  readonly viewerRef: RefObject<ContractViewerHandle | null>
  readonly onArmTemplatePlacement: (template: TemplateDefinition) => void
  readonly onCancelTemplatePlacement: () => void
  readonly onViewerPointerMove: (clientX: number, clientY: number) => void
  readonly onViewerPointerLeave: () => void
}

function PlaygroundPage({
  inputRef,
  mode,
  onModeChange,
  signatureMode,
  onSignatureModePresetChange,
  documentState,
  dragActive,
  setDragActive,
  isImporting,
  isLoading,
  statusMessage,
  errorMessage,
  onDocumentChange,
  selectedFieldId,
  selectedField,
  resolvedValues,
  onFileChange,
  onDrop,
  onLoadSample,
  onExportJson,
  onDeleteField,
  onFieldPatch,
  onDateFormatChange,
  onSignatureModeChange,
  onSelectField,
  pendingTemplate,
  cursorPosition,
  viewerSurfaceRef,
  viewerRef,
  onArmTemplatePlacement,
  onCancelTemplatePlacement,
  onViewerPointerMove,
  onViewerPointerLeave,
}: PlaygroundPageProps): JSX.Element {
  return (
    <>
      <header className="test-toolbar">
        <section className="toolbar-group toolbar-group-wide" aria-label="필드 추가">
          <div className="toolbar-label">필드 추가</div>
          <div className="field-button-row">
            {FIELD_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`tool-button${pendingTemplate?.id === template.id ? ' tool-button-active' : ''}`}
                onClick={() => onArmTemplatePlacement(template)}
                disabled={!documentState}
                title={template.description}
              >
                {template.title}
              </button>
            ))}
            {pendingTemplate ? (
              <button type="button" className="tool-button danger-action" onClick={onCancelTemplatePlacement}>
                취소
              </button>
            ) : null}
          </div>
          <div className="option-row" aria-label="서명 필드 생성 옵션">
            <span>서명 방식</span>
            <div className="mini-tabs">
              {SIGNATURE_MODES.map((nextSignatureMode) => (
                <button
                  key={nextSignatureMode}
                  type="button"
                  className={`mini-tab${signatureMode === nextSignatureMode ? ' active' : ''}`}
                  onClick={() => onSignatureModePresetChange(nextSignatureMode)}
                >
                  {SIGNATURE_MODE_LABELS[nextSignatureMode]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="toolbar-group" aria-label="모드 변경">
          <div className="toolbar-label">모드 변경</div>
          <div className="mode-tabs">
            {(['fill', 'sign', 'builder', 'readonly'] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={`mode-tab${mode === nextMode ? ' active' : ''}`}
                onClick={() => onModeChange(nextMode)}
                title={MODE_COPY[nextMode].note}
              >
                {MODE_COPY[nextMode].title}
              </button>
            ))}
          </div>
        </section>

        <section className="toolbar-group toolbar-group-file" aria-label="샘플과 파일">
          <div className="toolbar-label">샘플파일 선택</div>
          <div className="file-actions">
            <label
              className={`drop-button${dragActive ? ' drop-button-active' : ''}`}
              onDragEnter={() => setDragActive(true)}
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                setDragActive(false)
              }}
              onDrop={onDrop}
              title="PDF 또는 Pactum JSON"
            >
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                onChange={onFileChange}
              />
              파일
            </label>
            <button type="button" className="tool-button" onClick={() => void onLoadSample()}>
              {isImporting ? '불러오는 중' : '샘플'}
            </button>
            <button
              type="button"
              className="tool-button"
              onClick={onExportJson}
              disabled={!documentState}
            >
              내보내기
            </button>
          </div>
        </section>
      </header>

      <section className="status-strip">
        <div>
          <strong>{documentState?.title ?? '문서 없음'}</strong>
          <span>{isLoading ? '초기화 중입니다...' : statusMessage}</span>
        </div>
        <div className="status-meta">
          <span>{documentState ? `${documentState.pageCount}쪽` : '-'}</span>
          <span>{documentState ? `필드 ${documentState.fields.length}개` : '-'}</span>
          <span>{MODE_COPY[mode].title}</span>
        </div>
      </section>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <section className="test-layout">
        <div className="viewer-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">렌더러</p>
              <h2>ContractViewer</h2>
            </div>
            <div className="viewer-heading-meta">
              {cursorPosition ? (
                <span className="coordinate-chip">
                  {cursorPosition.page + 1}페이지 / {cursorPosition.x.toFixed(3)},{' '}
                  {cursorPosition.y.toFixed(3)} / 픽셀 {cursorPosition.absoluteX},{' '}
                  {cursorPosition.absoluteY}
                </span>
              ) : null}
              {pendingTemplate ? (
                <span className="status-chip">{pendingTemplate.title} 배치 중</span>
              ) : (
                <span className="status-chip">{MODE_COPY[mode].title}</span>
              )}
            </div>
          </div>

          <div className="viewer-frame">
            {documentState ? (
              <div
                ref={viewerSurfaceRef}
                className={`viewer-surface${pendingTemplate ? ' viewer-surface-placement' : ''}`}
                onPointerMove={(event) => onViewerPointerMove(event.clientX, event.clientY)}
                onPointerLeave={onViewerPointerLeave}
              >
                <ContractViewer
                  ref={viewerRef}
                  mode={mode}
                  document={documentState}
                  onDocumentChange={onDocumentChange}
                  viewportHeight="calc(100vh - 230px)"
                  pageWidth={760}
                  showPageNavigation
                  pdfWorkerSrc="/pdf.worker.min.mjs"
                />
              </div>
            ) : (
              <p className="empty-state">샘플을 불러오거나 PDF/JSON 파일을 선택해 테스트를 시작하세요.</p>
            )}
          </div>
        </div>

        <aside className="field-inspector">
          <div className="inspector-section">
            <div className="panel-heading compact-heading">
              <div>
                <p className="section-label">선택 필드</p>
                <h2>{selectedField ? selectedField.label || selectedField.name : '선택 없음'}</h2>
              </div>
              <button
                type="button"
                className="tool-button danger-action"
                onClick={onDeleteField}
                disabled={!selectedField}
              >
                삭제
              </button>
            </div>

            {selectedField ? (
              <div className="editor-grid">
                <label className="editor-field">
                  <strong>라벨</strong>
                  <input
                    type="text"
                    value={selectedField.label ?? ''}
                    onChange={(event) => onFieldPatch({ label: event.target.value })}
                  />
                </label>
                <label className="editor-field">
                  <strong>이름</strong>
                  <input
                    type="text"
                    value={selectedField.name}
                    onChange={(event) => onFieldPatch({ name: event.target.value })}
                  />
                </label>
                <label className="editor-field editor-field-wide">
                  <strong>플레이스홀더</strong>
                  <input
                    type="text"
                    value={selectedField.placeholder ?? ''}
                    placeholder={selectedField.type === 'date' ? 'yyyy.MM.dd' : '입력 안내 문구'}
                    onChange={(event) =>
                      onFieldPatch({ placeholder: event.target.value || undefined })
                    }
                  />
                </label>
                <label className="editor-field editor-field-wide">
                  <strong>글자 크기</strong>
                  <div className="range-field">
                    <input
                      type="range"
                      min="8"
                      max="32"
                      step="1"
                      value={selectedField.textSize ?? 10}
                      onChange={(event) =>
                        onFieldPatch({ textSize: Number(event.target.value) || 10 })
                      }
                    />
                    <input
                      type="number"
                      min="8"
                      max="32"
                      step="1"
                      value={selectedField.textSize ?? 10}
                      onChange={(event) =>
                        onFieldPatch({ textSize: Number(event.target.value) || 10 })
                      }
                    />
                  </div>
                </label>
                {selectedField.type === 'date' ? (
                  <label className="editor-field editor-field-wide">
                    <strong>날짜 포맷</strong>
                    <div className="format-field">
                      <select
                        value={
                          selectedField.dateFormat &&
                          DATE_FORMAT_PRESETS.includes(selectedField.dateFormat)
                            ? selectedField.dateFormat
                            : ''
                        }
                        onChange={(event) => onDateFormatChange(event.target.value)}
                      >
                        <option value="">직접 입력</option>
                        {DATE_FORMAT_PRESETS.map((format) => (
                          <option key={format} value={format}>
                            {format}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={selectedField.dateFormat ?? ''}
                        placeholder="yyyy.MM.dd"
                        onChange={(event) => onDateFormatChange(event.target.value)}
                      />
                    </div>
                  </label>
                ) : null}
                {selectedField.type === 'signature' ? (
                  <label className="editor-field editor-field-wide">
                    <strong>서명 방식</strong>
                    <div className="mini-tabs mini-tabs-stretch">
                      {SIGNATURE_MODES.map((nextSignatureMode) => (
                        <button
                          key={nextSignatureMode}
                          type="button"
                          className={`mini-tab${
                            (selectedField.signatureMode ?? 'all') === nextSignatureMode
                              ? ' active'
                              : ''
                          }`}
                          onClick={() => onSignatureModeChange(nextSignatureMode)}
                        >
                          {SIGNATURE_MODE_LABELS[nextSignatureMode]}
                        </button>
                      ))}
                    </div>
                  </label>
                ) : null}
                <label className="editor-field">
                  <strong>X</strong>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedField.x}
                    onChange={(event) => onFieldPatch({ x: Number(event.target.value) || 0 })}
                  />
                </label>
                <label className="editor-field">
                  <strong>Y</strong>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedField.y}
                    onChange={(event) => onFieldPatch({ y: Number(event.target.value) || 0 })}
                  />
                </label>
                <label className="editor-field">
                  <strong>너비</strong>
                  <input
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={selectedField.width}
                    onChange={(event) =>
                      onFieldPatch({ width: Number(event.target.value) || 0.01 })
                    }
                  />
                </label>
                <label className="editor-field">
                  <strong>높이</strong>
                  <input
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={selectedField.height}
                    onChange={(event) =>
                      onFieldPatch({ height: Number(event.target.value) || 0.01 })
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="empty-state">아래 목록에서 필드를 선택하거나 빌더 모드에서 필드를 추가하세요.</p>
            )}
          </div>

          <div className="inspector-section">
            <p className="section-label">필드 목록</p>
            {documentState?.fields.length ? (
              <div className="inventory-list">
                {documentState.fields.map((field) => (
                  <button
                    key={field.id}
                    type="button"
                    className={`inventory-row${selectedFieldId === field.id ? ' inventory-row-active' : ''}`}
                    onClick={() => onSelectField(field.id)}
                  >
                    <strong>{field.label || field.name}</strong>
                    <span>
                      {formatFieldType(field.type)} / {field.page + 1}페이지
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">아직 필드가 없습니다.</p>
            )}
          </div>

          <div className="inspector-section">
            <p className="section-label">해석된 값</p>
            {resolvedValues.length ? (
              <div className="value-list">
                {resolvedValues.map(([key, value]) => (
                  <div key={key} className="field-card">
                    <div className="field-card-header">
                      <strong>{key}</strong>
                      <span className="field-type">{getValueTypeLabel(value)}</span>
                    </div>
                    <div className="field-value">{formatValue(value)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">입력/서명 모드에서 입력한 값이 여기에 표시됩니다.</p>
            )}
          </div>
        </aside>
      </section>
    </>
  )
}

async function loadSampleDocument(): Promise<ContractDocument> {
  const response = await fetch('/sample-contract.pdf')
  if (!response.ok) {
    throw new Error('샘플 PDF 응답이 성공 상태가 아닙니다.')
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  return createDocumentFromPdfBytes(bytes, 'sample-contract.pdf')
}

async function loadContractFromFile(file: File): Promise<ContractDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'pdf' || file.type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return createDocumentFromPdfBytes(bytes, file.name)
  }

  if (extension === 'json' || file.type === 'application/json') {
    const raw = JSON.parse(await file.text()) as unknown
    return deserializeDocument(raw, file.name)
  }

  throw new Error('PDF와 Pactum JSON 파일만 지원합니다.')
}

async function createDocumentFromPdfBytes(
  pdfData: Uint8Array,
  fileName: string,
): Promise<ContractDocument> {
  const pdf = await PDFDocument.load(pdfData)
  const pages = pdf.getPages().map((page, index) => {
    const { width, height } = page.getSize()
    return { index, width, height }
  })

  return createDocument({
    id: createDocumentId(),
    title: fileName,
    pdfData,
    pageCount: pages.length,
    pages,
  })
}

function serializeDocument(documentState: ContractDocument) {
  return {
    ...documentState,
    pdfData: Array.from(documentState.pdfData),
    pageImages: documentState.pageImages?.map((page) => Array.from(page)),
  }
}

function deserializeDocument(raw: unknown, fallbackTitle: string): ContractDocument {
  if (!isRecord(raw)) {
    throw new Error('JSON 내용이 올바른 Pactum 문서가 아닙니다.')
  }

  const fields = Array.isArray(raw.fields) ? (raw.fields as ContractField[]) : []
  const pages = Array.isArray(raw.pages)
    ? raw.pages.map((page, index) => {
        if (!isRecord(page)) {
          throw new Error(`pages[${index}]는 올바른 페이지 정보가 아닙니다.`)
        }

        return {
          index: asNumber(page.index, `pages[${index}].index`),
          width: asNumber(page.width, `pages[${index}].width`),
          height: asNumber(page.height, `pages[${index}].height`),
        }
      })
    : []

  const documentState = createDocument({
    id: typeof raw.id === 'string' ? raw.id : createDocumentId(),
    title: typeof raw.title === 'string' ? raw.title : fallbackTitle,
    pdfData: readUint8Array(raw.pdfData, 'pdfData'),
    pageImages: Array.isArray(raw.pageImages)
      ? raw.pageImages.map((page, index) => readUint8Array(page, `pageImages[${index}]`))
      : undefined,
    pageCount: typeof raw.pageCount === 'number' ? raw.pageCount : pages.length,
    pages,
  })

  return {
    ...documentState,
    fields,
    fieldValues: readValueMap(raw.fieldValues),
    sharedValues: readValueMap(raw.sharedValues),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : documentState.createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : documentState.updatedAt,
  }
}

function readUint8Array(value: unknown, path: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value.map((entry, index) => asNumber(entry, `${path}[${index}]`)))
  }

  if (isRecord(value) && Array.isArray(value.data)) {
    return Uint8Array.from(
      value.data.map((entry, index) => asNumber(entry, `${path}.data[${index}]`)),
    )
  }

  if (typeof value === 'string') {
    const binary = atob(value)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }

  throw new Error(`${path} 값을 Uint8Array로 읽을 수 없습니다.`)
}

function createDocumentId(): string {
  const browserCrypto = globalThis.crypto

  if (typeof browserCrypto?.randomUUID === 'function') {
    return `doc-${browserCrypto.randomUUID()}`
  }

  if (typeof browserCrypto?.getRandomValues === 'function') {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))

    return `doc-${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }

  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} 값은 유효한 숫자여야 합니다.`)
  }

  return value
}

function readValueMap(value: unknown): Record<string, ContractFieldValue> {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeFieldValue(entry)]),
  )
}

function normalizeFieldValue(value: unknown): ContractFieldValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (isRecord(value) && value.type === 'signature') {
    return {
      type: 'signature',
      source:
        value.source === 'draw' || value.source === 'stamp'
          ? value.source
          : undefined,
      image: readUint8Array(value.image, 'signature.image'),
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
      width: typeof value.width === 'number' ? value.width : undefined,
      height: typeof value.height === 'number' ? value.height : undefined,
    }
  }

  throw new Error('fieldValues/sharedValues에 지원하지 않는 값이 있습니다.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function formatValue(value: unknown): string {
  if (value == null) return '비어 있음'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function formatFieldType(type: ContractFieldType): string {
  return FIELD_TYPE_LABELS[type]
}

function getValueTypeLabel(value: unknown): string {
  if (isRecord(value) && typeof value.type === 'string') {
    const type = value.type as ContractFieldType
    return FIELD_TYPE_LABELS[type] ?? type
  }

  return '값'
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
