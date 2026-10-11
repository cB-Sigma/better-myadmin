declare module 'seek-bzip' {
  const Bunzip: { decode(input: Buffer, output?: Buffer): Buffer }
  export default Bunzip
}
