'use client'

import { useEffect, useRef, useState } from 'react'

type CommentTarget = {
  selector: string
  elementSnippet: string
  text?: string
}

const ENABLE_MESSAGE_TYPES = new Set(['ai-v2-comment-mode-on', 'ai-comment-mode-on'])

const DISABLE_MESSAGE_TYPES = new Set(['ai-v2-comment-mode-off', 'ai-comment-mode-off'])

const IGNORED_TAGS = new Set([
  'HTML',
  'BODY',
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'META',
  'LINK',
])
const MIN_TARGET_AREA = 16

function normalizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, maxLength - 3) + '...'
}

function sanitizeSelectorPart(value: string | null | undefined, fallback: string) {
  const normalized = normalizeText(value ?? '', 80)
    .replace(/:{2,}/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

function getNthOfType(element: Element) {
  let index = 1
  let previous = element.previousElementSibling

  while (previous) {
    if (previous.tagName === element.tagName) index += 1
    previous = previous.previousElementSibling
  }

  return index
}

function getSegment(element: Element) {
  const tagName = element.tagName.toLowerCase()
  const id = element.id ? '#' + sanitizeSelectorPart(element.id, 'id') : ''
  const className = Array.from(element.classList)
    .filter((item) => !item.startsWith('__ai-builder'))
    .slice(0, 2)
    .map((item) => '.' + sanitizeSelectorPart(item, 'class'))
    .join('')

  return tagName + id + className + ':nth-of-type(' + getNthOfType(element) + ')'
}

function getTagPath(element: Element, sectionRoot: Element | null) {
  const segments: string[] = []
  let current: Element | null = element

  while (current && current !== document.body && current !== sectionRoot) {
    segments.unshift(getSegment(current))
    current = current.parentElement
  }

  return segments.slice(-6).join('>')
}

function getElementSnippet(element: HTMLElement) {
  if (element instanceof HTMLImageElement) {
    const alt = element.alt ? ' alt="' + normalizeText(element.alt, 120) + '"' : ''
    const src = element.currentSrc || element.src
    return '<img' + alt + ' src="' + normalizeText(src, 220) + '">'
  }

  return normalizeText(element.outerHTML, 700)
}

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  if (target instanceof Node && target.parentNode instanceof Element) return target.parentNode
  return null
}

function nearestHTMLElement(element: Element | null): HTMLElement | null {
  let current: Element | null = element
  while (current && !(current instanceof HTMLElement)) current = current.parentElement
  return current instanceof HTMLElement ? current : null
}

function isBridgeElement(element: HTMLElement) {
  return Boolean(element.closest('[data-ai-builder-comment-bridge="true"]'))
}

function isSelectableCandidate(element: HTMLElement) {
  if (IGNORED_TAGS.has(element.tagName)) return false
  if (isBridgeElement(element)) return false

  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2 || rect.width * rect.height < MIN_TARGET_AREA) return false

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number(style.opacity) === 0) return false

  return true
}

function findSelectableElement(target: EventTarget | Element | null) {
  let current = nearestHTMLElement(elementFromTarget(target))

  while (current && current !== document.body && current !== document.documentElement) {
    if (isSelectableCandidate(current)) return current
    current = current.parentElement
  }

  return null
}

function findSelectableElementAtPoint(event: MouseEvent | PointerEvent) {
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  return findSelectableElement(hit || event.target)
}

function createCommentTarget(element: HTMLElement): CommentTarget {
  const sectionRoot = element.closest<HTMLElement>('[data-section-slug]')
  const sectionSlug = sanitizeSelectorPart(sectionRoot?.dataset.sectionSlug, 'page')
  const tagPath = sanitizeSelectorPart(
    getTagPath(element, sectionRoot),
    element.tagName.toLowerCase(),
  )
  const selector = sectionSlug + '::' + tagPath + '::' + getNthOfType(element)
  const text = normalizeText(
    element.innerText || element.getAttribute('aria-label') || element.getAttribute('alt') || '',
    280,
  )

  return {
    selector,
    elementSnippet: getElementSnippet(element),
    ...(text ? { text } : {}),
  }
}

function updateOverlay(overlay: HTMLDivElement, element: HTMLElement | null) {
  if (!element) {
    overlay.style.display = 'none'
    return
  }

  const rect = element.getBoundingClientRect()

  overlay.style.display = 'block'
  overlay.style.left = Math.max(0, rect.left) + 'px'
  overlay.style.top = Math.max(0, rect.top) + 'px'
  overlay.style.width = Math.max(0, rect.width) + 'px'
  overlay.style.height = Math.max(0, rect.height) + 'px'
}

export function AiBuilderCommentBridge(): null {
  const [enabled, setEnabled] = useState(false)
  const hoveredElementRef = useRef<HTMLElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return

      const messageType =
        typeof event.data === 'object' && event.data !== null && 'type' in event.data
          ? String(event.data.type)
          : ''

      if (ENABLE_MESSAGE_TYPES.has(messageType)) {
        setEnabled(true)
        return
      }

      if (DISABLE_MESSAGE_TYPES.has(messageType)) {
        setEnabled(false)
        return
      }

      if (
        messageType === 'ai-v2-comment-mode' &&
        typeof event.data === 'object' &&
        event.data !== null &&
        'enabled' in event.data
      ) {
        setEnabled(Boolean(event.data.enabled))
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!enabled) {
      hoveredElementRef.current = null
      overlayRef.current?.remove()
      overlayRef.current = null
      document.documentElement.style.cursor = ''
      return
    }

    const overlay = document.createElement('div')
    overlay.dataset.aiBuilderCommentBridge = 'true'
    overlay.setAttribute('aria-hidden', 'true')
    overlay.style.position = 'fixed'
    overlay.style.display = 'none'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '2147483647'
    overlay.style.border = '2px solid #2563eb'
    overlay.style.borderRadius = '6px'
    overlay.style.background = 'rgba(37, 99, 235, 0.12)'
    overlay.style.boxShadow = '0 0 0 9999px rgba(15, 23, 42, 0.08)'
    overlay.style.transition = 'left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease'
    document.body.appendChild(overlay)
    overlayRef.current = overlay
    document.documentElement.style.cursor = 'crosshair'

    function updateHoveredElement(element: HTMLElement | null) {
      hoveredElementRef.current = element
      updateOverlay(overlay, element)
    }

    function onPointerMove(event: PointerEvent) {
      updateHoveredElement(findSelectableElementAtPoint(event))
    }

    function onPointerOut(event: PointerEvent) {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && document.contains(relatedTarget)) return
      updateHoveredElement(null)
    }

    function onViewportChange() {
      updateOverlay(overlay, hoveredElementRef.current)
    }

    function onClick(event: MouseEvent) {
      const element = findSelectableElementAtPoint(event)
      if (!element) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      window.parent.postMessage(
        {
          type: 'ai-v2-comment-target',
          target: createCommentTarget(element),
        },
        '*',
      )
    }

    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerover', onPointerMove, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('click', onClick, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)

    return () => {
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerover', onPointerMove, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      hoveredElementRef.current = null
      overlay.remove()
      overlayRef.current = null
      document.documentElement.style.cursor = ''
    }
  }, [enabled])

  return null
}
