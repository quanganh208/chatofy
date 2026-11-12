import { describe, expect, it } from 'vitest';
import { createTranslator, en, vi as viMessages } from '@chatofy/i18n';
import type { Conversation, ConversationTurn, MinutesContent } from '@chatofy/types';
import { transcriptMarkdown, transcriptText, turnTranslations } from './conversation-export';
import { exportFilename, recordingExtension, slugify } from './conversation-export-filename';
import { canExportSrt, srtTimestamp, transcriptSrt } from './conversation-export-srt';

/**
 * The three files a conversation leaves History as, and their names.
 *
 * Every number here is what the transcript on screen would show for the same
 * conversation: offsets go through `mediaOffset`, so a recording that began 1.4 s
 * after the conversation shifts every stamp by exactly that.
 */

const t = createTranslator(en);

function turn(over: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    position: 0,
    speakerRole: 'speaker_a',
    speakerLabel: null,
    sourceText: 'Xin chào, tôi muốn đặt bàn cho bốn người tối nay.',
    displayText: null,
    sourceLanguages: ['vi'],
    translations: { en: "Hello, I'd like to book a table for four tonight." },
    offsetMs: 0,
    ...over,
  };
}

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: 'c-1',
    languages: ['vi', 'en'],
    startedAt: '2026-11-12T07:58:00.000Z',
    endedAt: '2026-11-12T07:59:00.000Z',
    turnCount: 2,
    preview: 'Xin chào',
    hasMinutes: false,
    pausedMs: 0,
    title: 'Đặt bàn nhà hàng cho bốn người',
    kind: 'two-way',
    hasRecording: true,
    speakerCount: 2,
    speakers: [],
    audioOffsetMs: null,
    audioDurationMs: null,
    turns: [
      turn(),
      turn({
        position: 1,
        speakerRole: 'speaker_b',
        sourceText: 'Of course. What time would you like to come in?',
        sourceLanguages: ['en'],
        translations: { vi: 'Dĩ nhiên rồi. Anh chị muốn đến lúc mấy giờ?' },
        offsetMs: 6_000,
      }),
    ],
    ...over,
  };
}

const MINUTES: MinutesContent = {
  status: 'ready',
  summary: 'Speaker A booked a table for four.',
  keyPoints: ['Four people'],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-11-12T08:00:00.000Z',
  model: 'test',
};

describe('the text export', () => {
  it('heads the file with the title, the date and time range, and the pair', () => {
    const text = transcriptText(conversation(), t, 'en');
    expect(text.split('\n').slice(0, 3)).toEqual([
      'Đặt bàn nhà hàng cho bốn người',
      'Nov 12, 2026 · 7:58 AM–7:59 AM · Vietnamese ⇆ English',
      '',
    ]);
  });

  it('writes each turn as a stamped speaker, the source and its translation', () => {
    const text = transcriptText(conversation(), t, 'en');
    expect(text).toContain(
      [
        '[0:00] Speaker A',
        'Xin chào, tôi muốn đặt bàn cho bốn người tối nay.',
        "→ Hello, I'd like to book a table for four tonight.",
        '',
        '[0:06] Speaker B',
        'Of course. What time would you like to come in?',
        '→ Dĩ nhiên rồi. Anh chị muốn đến lúc mấy giờ?',
      ].join('\n'),
    );
    expect(text.endsWith('?\n')).toBe(true);
  });

  it('shifts stamps by the recording offset, as the transcript gutter does', () => {
    const text = transcriptText(conversation({ audioOffsetMs: 1_400 }), t, 'en');
    expect(text).toContain('[0:00] Speaker A');
    expect(text).toContain('[0:04] Speaker B');
  });

  it('omits the stamp of a turn with no offset rather than inventing 0:00', () => {
    const text = transcriptText(conversation({ turns: [turn({ offsetMs: null })] }), t, 'en');
    expect(text).toContain('\nSpeaker A\nXin chào');
    expect(text).not.toContain('[');
  });

  it('names a speaker by the confirmed label, and localizes the fallback', () => {
    const named = conversation({ turns: [turn({ speakerLabel: 'Lan' })] });
    expect(transcriptText(named, t, 'en')).toContain('[0:00] Lan\n');
    const vi = createTranslator(viMessages);
    expect(transcriptText(conversation(), vi, 'vi')).toContain('[0:00] Người nói A\n');
  });

  it('lists every translation, the displayed one first', () => {
    const mixed = turn({
      sourceLanguages: ['vi', 'en'],
      translations: { en: 'One', vi: 'Một' },
    });
    expect(turnTranslations(mixed, ['vi', 'en'])).toEqual(['One', 'Một']);
    const text = transcriptText(conversation({ turns: [mixed] }), t, 'en');
    expect(text).toContain('→ One\n→ Một');
  });

  it('reads the repaired line when there is one', () => {
    const repaired = conversation({ turns: [turn({ displayText: 'Xin chào.' })] });
    expect(transcriptText(repaired, t, 'en')).toContain('\nXin chào.\n');
  });

  it('falls back to "Untitled conversation" and names auto-detect and one-way', () => {
    const untitled = conversation({ title: null, kind: 'auto-detect', languages: ['en', 'vi'] });
    const text = transcriptText(untitled, t, 'en');
    expect(text.startsWith('Untitled conversation\n')).toBe(true);
    expect(text).toContain('Auto-detect → English');
    expect(transcriptText(conversation({ kind: 'one-way' }), t, 'en')).toContain(
      'Vietnamese → English',
    );
  });
});

describe('the Markdown export', () => {
  it('is the same transcript, as headings, bold speakers and quoted translations', () => {
    const md = transcriptMarkdown(conversation(), t, 'en');
    expect(md).toContain('# Đặt bàn nhà hàng cho bốn người\n\n_Nov 12, 2026 · ');
    expect(md).toContain('## Transcript\n\n**0:00 · Speaker A**  \nXin chào');
    expect(md).toContain("\n> Hello, I'd like to book a table for four tonight.\n");
    expect(md).not.toContain('## Minutes');
  });

  it('joins several translations into one quote with hard breaks', () => {
    const mixed = turn({ sourceLanguages: ['vi', 'en'], translations: { en: 'One', vi: 'Một' } });
    const md = transcriptMarkdown(conversation({ turns: [mixed] }), t, 'en');
    expect(md).toContain('> One  \n> Một\n');
  });

  it('appends the minutes only when they are ready', () => {
    const md = transcriptMarkdown(conversation(), t, 'en', MINUTES);
    expect(md).toContain(
      '## Minutes\n\n### Summary\nSpeaker A booked a table for four.\n\n### Key points\n- Four people',
    );
    expect(md).toContain('### Action items\nNo action items.');
    const pending = transcriptMarkdown(conversation(), t, 'en', { ...MINUTES, status: 'pending' });
    expect(pending).not.toContain('## Minutes');
  });

  it('writes an unstamped turn with the speaker alone', () => {
    const md = transcriptMarkdown(conversation({ turns: [turn({ offsetMs: null })] }), t, 'en');
    expect(md).toContain('**Speaker A**  \n');
  });
});

describe('the subtitle export', () => {
  it('writes HH:MM:SS,mmm', () => {
    expect(srtTimestamp(0)).toBe('00:00:00,000');
    expect(srtTimestamp(6_000)).toBe('00:00:06,000');
    expect(srtTimestamp(3_723_045)).toBe('01:02:03,045');
  });

  it('numbers cues from 1 and ends each where the next begins', () => {
    const srt = transcriptSrt(conversation());
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:06,000\nXin chào')).toBe(true);
    expect(srt).toContain(
      "tối nay.\nHello, I'd like to book a table for four tonight.\n\n2\n00:00:06,000 --> ",
    );
  });

  it('ends the last cue at the active end, or five seconds on, whichever is later', () => {
    // A minute of conversation, the last turn at 0:06: the active end wins.
    expect(transcriptSrt(conversation())).toContain('2\n00:00:06,000 --> 00:01:00,000\n');
    // Paused for 58 s, so the active end (0:02) is before the turn: five seconds.
    expect(transcriptSrt(conversation({ pausedMs: 58_000 }))).toContain(
      '2\n00:00:06,000 --> 00:00:11,000\n',
    );
    // On the recording's clock, like the starts: shifted by the recording offset.
    expect(transcriptSrt(conversation({ audioOffsetMs: 2_000 }))).toContain(
      '2\n00:00:04,000 --> 00:00:58,000\n',
    );
  });

  it('is unavailable when any turn lacks an offset, and refuses to guess one', () => {
    const gap = conversation({ turns: [turn(), turn({ position: 1, offsetMs: null })] });
    expect(canExportSrt(gap)).toBe(false);
    expect(canExportSrt(conversation())).toBe(true);
    expect(() => transcriptSrt(gap)).toThrow();
  });

  it('keeps a blank line inside a turn from splitting its cue', () => {
    const srt = transcriptSrt(conversation({ turns: [turn({ sourceText: 'A\n\nB' })] }));
    expect(srt).toContain('A\nB\n');
  });
});

describe('the file name', () => {
  it('is an ASCII kebab-case slug of the title, then the start day', () => {
    expect(exportFilename(conversation(), 'txt')).toBe(
      'dat-ban-nha-hang-cho-bon-nguoi-2026-11-12.txt',
    );
    expect(slugify('Hỏi đường đến ga Hà Nội!')).toBe('hoi-duong-den-ga-ha-noi');
    expect(slugify('ĐÀ NẴNG — Check-in')).toBe('da-nang-check-in');
  });

  it('falls back to "conversation" when nothing of the title is left', () => {
    expect(slugify(null)).toBe('conversation');
    expect(slugify('你好')).toBe('conversation');
    expect(exportFilename(conversation({ title: null }), 'srt')).toBe(
      'conversation-2026-11-12.srt',
    );
  });

  it('caps a long title without leaving a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(59)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('picks the recording extension from the blob type', () => {
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingExtension('audio/ogg')).toBe('ogg');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('')).toBe('webm');
  });
});
