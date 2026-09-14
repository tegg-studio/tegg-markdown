export type NewlinePolicy={kind:"lf"|"crlf"|"cr"|"mixed";bom:boolean;readOnly:boolean;lineSeparator:"\n"|"\r\n"};
/** Preserve unsupported/mixed separators until the Host explicitly creates a normalized copy. */
export function detectNewlinePolicy(source:string):NewlinePolicy{
  const crlf=source.includes("\r\n"),lf=/(^|[^\r])\n/.test(source),cr=/\r(?!\n)/.test(source);
  const kind=Number(crlf)+Number(lf)+Number(cr)>1?"mixed":cr?"cr":crlf?"crlf":"lf";
  return {kind,bom:source.startsWith("\ufeff"),readOnly:kind==="mixed"||kind==="cr",lineSeparator:kind==="crlf"?"\r\n":"\n"};
}
