---
name: zaiskills-ocr
description: "ZAISkills-OCR: ZAISkills 专用的本地图片 OCR 文件还原流程，复用 local-photo-ocr 的本地 Vision OCR、严格逐行校对、代码/JSON/Markdown 校验规则，并把生成文件和素材归档到 skill-tiqu。Use when the user asks to extract text from screenshots/photos into ZAISkills files, recreate CLI/script/skill files from images, or says “提取文字到文件”, “按图片生成”, “截图还原”, “ZAISkills-OCR”. Default behavior is exact screenshot transcription without acs-to-zai rewriting unless explicitly requested."
---

# ZAISkills-OCR

Use this skill for ZAISkills repository screenshot/photo transcription tasks. It follows `local-photo-ocr` exact line-by-line rules and adds a required archival layout under:

```text
/Users/zjf/Downloads/developer/ai/temp/skill-tiqu
```

## Core Rules

- Keep all images local. Do not use web search, cloud OCR, image generation, or third-party OCR APIs.
- Read and apply `local-photo-ocr` first. Its exact line-by-line workflow is mandatory by default.
- Treat screenshots/photos as the only source of truth. OCR output is only a rough draft.
- Preserve visible line order, blank lines, indentation, comments, punctuation, command names, paths, variable names, heredocs, and final line count.
- Do not include IDE/editor chrome or left gutter line numbers in final files unless explicitly requested. Use visible line numbers only for `nl -ba` verification.
- Treat line verification as a delivery gate. Do not deliver a file as complete unless `nl -ba` readback matches the screenshot-visible line numbers, total line count, blank lines, and every visible line's content, except for lines explicitly reported as visually uncertain.
- Never rely on `wc -l`, OCR maximum line numbers, syntax checks, or visual "looks close" review as the only verification. They are auxiliary signals only.
- Before writing, build a source image map for every target file: source images, visible line ranges, overlap boundaries, last visible content line, and whether a final visible line is only the editor's blank cursor line.
- The ZAISkills target filename does not imply permission to rewrite screenshot content. If the screenshot says `acs-junior`, keep `acs-junior` by default even when the requested output file is named `zai-junior`.
- Do not automatically rename `acs-*` to `zai-*`, change paths, adapt package names, optimize code, or fix style unless the user explicitly asks for adaptation.
- If the user explicitly asks to “适配为 zai”, “改成 zai 命名”, “优化”, or “修复代码”, first reconstruct the screenshot text, then make only the requested minimal transformation and report the changed lines/identifiers.
- Always copy every source image used for OCR into the matching directory's `素材/<target-top-level-dir>/` folder before or while generating the output.
- Use `apply_patch` for creating or editing final files in the ZAISkills workspace. Use shell commands such as `mkdir` and `cp -p` only for archive directories and image copies.
- If a line is blurred, cropped, covered, or otherwise not confirmable, ask for a clearer image or report the uncertain line explicitly. Do not invent missing content.

## Directory Mapping

Map the requested ZAISkills target path to an archive directory:

- `bin/zai-cc` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/bin/zai-cc`
- `zai-bug-fix/SKILL.md` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/zai-bug-fix/SKILL.md`
- `zai-apk-reverse/scripts/analyze.sh` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/zai-apk-reverse/scripts/analyze.sh`

For each target, copy images to `素材/<target-top-level-dir>/`, where `<target-top-level-dir>` is the first path segment of the target relative to the ZAISkills workspace:

```text
/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/<target-parent-dir>/素材/<target-top-level-dir>/
```

Examples:

- `bin/zai-cc` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/bin/素材/bin/`
- `zai-bug-fix/SKILL.md` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/zai-bug-fix/素材/zai-bug-fix/`
- `zai-apk-reverse/scripts/analyze.sh` -> `/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/zai-apk-reverse/scripts/素材/zai-apk-reverse/`

If the target has no parent directory, use:

```text
/Users/zjf/Downloads/developer/ai/temp/skill-tiqu/root/素材/root/
```

## Workflow

1. Identify the requested output target path and all local image paths from the user message.
2. Resolve the target parent directory and target top-level directory relative to the ZAISkills workspace, then create the corresponding archive directory and its `素材/<target-top-level-dir>/` subfolder.
3. Copy each source image into the `素材/<target-top-level-dir>/` subfolder with `cp -p`. If filenames collide, add a short numeric suffix while preserving the extension.
4. Run local OCR with macOS Vision:

   ```bash
   swift /Users/zjf/.codex/skills/local-photo-ocr/scripts/ocr_vision.swift image1.jpg image2.jpg > /tmp/zaiskills-ocr.txt
   ```

5. Build a `Source Image Map` before reconstructing:
   - For every image, record the archive image path, workspace target file, archive target file, visible line range, overlap with adjacent images, and last visible content line.
   - If source images are in a shared folder such as `all/`, map by visible tab/path/title and content, not by filename order alone.
   - Mark editor-only blank cursor lines separately. Do not count them as file content unless the screenshot clearly shows a real blank line inside the file.
   - If a source image cannot be confidently mapped to exactly one target file, stop and ask for clarification or report the ambiguity.
6. Reconstruct the requested file exactly from the visible image content:
   - Keep blank lines in visible positions.
   - Keep each visible source line as one output line.
   - Keep indentation, comments, punctuation, filenames, identifiers, command names, paths, and message text as shown.
   - Merge overlapping screenshots by line number and prefer the clearest visible version.
   - Do not add helper imports, shared functions, syntax repairs, comments, or formatting just because the result seems more runnable.
7. Write the reconstructed file to the archive target path first.
8. If the user asked to update the ZAISkills repo file, also write the same content to the workspace target path with `apply_patch`.
9. Read back the archive file and any workspace file with:

   ```bash
   nl -ba file
   ```

10. Compare `nl -ba` output against the `Source Image Map` and screenshots, not just final line count:
   - Verify each image's first and last visible content line.
   - Verify every overlap boundary between adjacent images.
   - Verify blank lines and code-fence/heredoc boundaries exactly.
   - Verify the final content line separately from any editor blank cursor line.
   - Use `wc -l` only as a quick summary after `nl -ba`; it cannot pass the delivery gate by itself.
   - Build a mismatch list with the file line number, screenshot-visible text, and written text.
   - If both archive and workspace files are written, confirm they contain the same content, for example with `cmp -s archive-file workspace-file`.
   - If any fixable mismatch remains in either file, edit the file and repeat the `nl -ba` readback before continuing.
   - If the mismatch cannot be resolved because the image is blurred, cropped, or covered, do not mark the task complete; ask for a clearer image or explicitly list the uncertain lines in the final response.
   - Line verification is stricter than syntax validation. Syntax checks cannot substitute for matching the screenshot line count and content.
11. Run validation appropriate to the file type, but do not let validation override screenshot-visible text:
   - Shell: `bash -n file`
   - JavaScript: `node --check file.js`
   - JSON: `python3 -m json.tool file.json >/dev/null`
   - Markdown/skill files: inspect headings, code fences, frontmatter, and tables in plain text.
12. Delete temporary OCR output and any ad hoc helper files.

## Final Response

Report:

- The archive file path.
- The archive `素材/<target-top-level-dir>/` folder path.
- Any ZAISkills workspace file path updated.
- That OCR and image handling stayed local.
- That a source image map was built and `nl -ba` line verification passed image-by-image for the archive file and any workspace file.
- Validation performed, any intentionally transformed lines, or any uncertain lines that could not be confirmed.
- If any line number, line count, blank line, or visible content mismatch remains, do not say the file is complete. State that delivery is blocked and list the mismatched or uncertain lines.
