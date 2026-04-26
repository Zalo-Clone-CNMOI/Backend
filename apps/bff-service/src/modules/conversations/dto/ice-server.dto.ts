export class IceServerConfigDto {
  urls: string;
  username?: string;
  credential?: string;
}

export class IceServersResponseDto {
  username: string;
  credential: string;
  ttl: number;
  ice_servers: IceServerConfigDto[];
}
