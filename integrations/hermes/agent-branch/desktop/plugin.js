// agent-branch — desktop pane. Loaded uncompiled by Hermes Desktop, so no JSX:
// UI is written with jsx()/jssx() calls. Read-only surface over the plugin's
// backend (/api/plugins/agent-branch): profile quality scores, analysis
// findings with file:line evidence, and past triggering-eval Insights.
// Running an eval costs tokens and stays on the agent surfaces (/branch eval).
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const SEVERITY_GLYPH = { error: '✗', warning: '!', info: '·' }
const SEVERITY_COLOR = {
  error: 'var(--ui-accent)',
  warning: 'var(--ui-text-secondary)',
  info: 'var(--ui-text-tertiary)'
}

function Section({ title, children }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] uppercase tracking-wide',
        style: { color: 'var(--ui-text-quaternary)' },
        children: title
      }),
      children
    ]
  })
}

function Finding({ finding }) {
  const evidence = finding.evidence || {}
  const where = evidence.path
    ? evidence.path + (evidence.line ? ':' + evidence.line : '')
    : ''
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 py-1',
    style: { borderBottom: '1px solid var(--ui-stroke-secondary)' },
    children: [
      jsxs('div', {
        className: 'flex gap-1.5 text-xs',
        children: [
          jsx('span', {
            style: { color: SEVERITY_COLOR[finding.severity] },
            children: SEVERITY_GLYPH[finding.severity] || '·'
          }),
          jsxs('span', {
            style: { color: 'var(--ui-text-secondary)' },
            children: [
              where
                ? jsx('span', {
                    className: 'font-mono mr-1',
                    style: { color: 'var(--ui-text-tertiary)' },
                    children: where
                  })
                : null,
              finding.message
            ]
          })
        ]
      }),
      jsx('div', {
        className: 'pl-4 text-[0.6875rem]',
        style: { color: 'var(--ui-text-tertiary)' },
        children: 'fix: ' + finding.fix
      })
    ]
  })
}

function RunRow({ record }) {
  const insight = record.insight || {}
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 py-1 text-xs',
    style: { borderBottom: '1px solid var(--ui-stroke-secondary)' },
    children: [
      jsxs('div', {
        className: 'flex justify-between gap-2',
        children: [
          jsx('span', {
            style: { color: 'var(--ui-text-secondary)' },
            children: record.skill
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-quaternary)' },
            children: record.error ? 'error' : insight.verdict || '—'
          })
        ]
      }),
      jsx('div', {
        className: 'text-[0.6875rem]',
        style: { color: 'var(--ui-text-tertiary)' },
        children: record.error || insight.summary || ''
      })
    ]
  })
}

function makePane(ctx) {
  return function AgentBranchPane() {
    const [profileList, setProfileList] = useState(null)
    const [active, setActive] = useState('default')
    const [artifact, setArtifact] = useState(null)
    const [runs, setRuns] = useState([])
    const [error, setError] = useState(null)
    const [tick, setTick] = useState(0)

    useEffect(() => {
      let live = true
      ctx
        .rest('/profiles')
        .then(data => {
          if (!live) return
          setProfileList(data.profiles || [])
          setError(null)
        })
        .catch(() => live && setError('Backend off — enable the agent-branch plugin in config.yaml.'))
      return () => {
        live = false
      }
    }, [tick])

    useEffect(() => {
      let live = true
      ctx
        .rest('/analysis?profile=' + encodeURIComponent(active))
        .then(data => live && setArtifact(data))
        .catch(() => live && setArtifact(null))
      ctx
        .rest('/insights?profile=' + encodeURIComponent(active))
        .then(data => live && setRuns(data.records || []))
        .catch(() => live && setRuns([]))
      return () => {
        live = false
      }
    }, [active, tick])

    if (error) {
      return jsx('div', {
        className: 'p-3 text-xs',
        style: { color: 'var(--ui-text-tertiary)' },
        children: error
      })
    }

    return jsxs('div', {
      className: 'flex h-full flex-col gap-3 overflow-y-auto p-3',
      children: [
        jsxs('div', {
          className: 'flex items-center justify-between',
          children: [
            jsx('div', {
              className: 'text-sm font-medium',
              children: 'agent.branch'
            }),
            jsx('button', {
              type: 'button',
              className: 'text-[0.6875rem]',
              style: { color: 'var(--ui-text-tertiary)' },
              onClick: () => setTick(t => t + 1),
              children: 'refresh'
            })
          ]
        }),
        jsx(Section, {
          title: 'Profiles',
          children: jsx('div', {
            className: 'flex flex-wrap gap-1',
            children: (profileList || []).map(profile =>
              jsxs('button', {
                type: 'button',
                className: 'rounded px-1.5 py-0.5 text-xs',
                style: {
                  border: '1px solid var(--ui-stroke-secondary)',
                  color:
                    profile.name === active
                      ? 'var(--ui-accent)'
                      : 'var(--ui-text-secondary)'
                },
                onClick: () => setActive(profile.name),
                children: [profile.name + ' ', profile.score + '/100']
              }, profile.name)
            )
          })
        }),
        artifact && !artifact.error
          ? jsx(Section, {
              title:
                'Analysis — score ' +
                artifact.score +
                '/100, ' +
                artifact.skill_count +
                ' skills',
              children: artifact.findings.length
                ? jsx('div', {
                    className: 'flex flex-col',
                    children: artifact.findings.map((finding, index) =>
                      jsx(Finding, { finding }, index)
                    )
                  })
                : jsx('div', {
                    className: 'text-xs',
                    style: { color: 'var(--ui-text-tertiary)' },
                    children: 'No findings — the configuration is in good shape.'
                  })
            })
          : null,
        jsx(Section, {
          title: 'Past runs',
          children: runs.length
            ? jsx('div', {
                className: 'flex flex-col',
                children: runs.map(record => jsx(RunRow, { record }, record.id))
              })
            : jsx('div', {
                className: 'text-xs',
                style: { color: 'var(--ui-text-tertiary)' },
                children: 'No runs yet — run one with /branch eval <skill>.'
              })
        })
      ]
    })
  }
}

export default {
  id: 'agent-branch',
  name: 'agent.branch',
  register(ctx) {
    const Pane = makePane(ctx)
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'agent.branch',
      data: { placement: 'right', width: '320px' },
      render: () => jsx(Pane, {})
    })
  }
}
